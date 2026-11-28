import crypto from 'node:crypto';
import { put, list, del } from '@vercel/blob';

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2 MB per CAD entry
const MAX_THUMBNAIL_CHARS = 160_000;
const MAX_SCRIPT_CHARS = 30_000;
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{6,64}$/;

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function sanitizeText(value, maxLen, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_PAYLOAD_BYTES) {
      const err = new Error('Dữ liệu quá lớn (tối đa 2MB).');
      err.statusCode = 413;
      throw err;
    }
    return JSON.parse(req.body);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_PAYLOAD_BYTES) {
      const err = new Error('Dữ liệu quá lớn (tối đa 2MB).');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function toPublicMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const { deleteTokenHash: _hidden, ...publicFields } = meta;
  return publicFields;
}

function getHeader(req, name) {
  const lower = name.toLowerCase();
  const headers = req.headers || {};
  const val = headers[lower] ?? headers[name];
  return Array.isArray(val) ? val[0] : val;
}

function validateCreatePayload(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Dữ liệu gửi lên không hợp lệ.' };
  }

  const name = sanitizeText(body.name, 80);
  if (!name) {
    return { error: 'Vui lòng nhập tên mẫu CAD.' };
  }

  const author = sanitizeText(body.author, 40, 'Ẩn danh');

  const has3D = Boolean(
    body.state3d &&
    typeof body.state3d === 'object' &&
    body.state3d.geom &&
    typeof body.state3d.geom === 'object'
  );
  const has2D = Boolean(
    body.state2d &&
    typeof body.state2d === 'object' &&
    Array.isArray(body.state2d.elements) &&
    body.state2d.elements.length > 0
  );

  if (!has3D && !has2D) {
    return { error: 'Bài CAD cần có dữ liệu hình khối 3D hoặc bản vẽ 2D.' };
  }

  let thumbnail = '';
  if (typeof body.thumbnail === 'string' && body.thumbnail) {
    if (
      body.thumbnail.length <= MAX_THUMBNAIL_CHARS &&
      /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(body.thumbnail)
    ) {
      thumbnail = body.thumbnail;
    }
  }

  const script = typeof body.script === 'string' ? body.script.slice(0, MAX_SCRIPT_CHARS) : '';
  const frontRotDeg = Number.isFinite(Number(body.frontRotDeg)) ? Number(body.frontRotDeg) : 0;

  const dims = has3D
    ? {
        w: Math.max(1, Math.round(Number(body.state3d.w) || 6)),
        h: Math.max(1, Math.round(Number(body.state3d.h) || 4)),
        d: Math.max(1, Math.round(Number(body.state3d.d) || 4))
      }
    : null;

  const dataPayload = {
    version: 1,
    state3d: has3D
      ? {
          w: dims.w,
          h: dims.h,
          d: dims.d,
          geom: body.state3d.geom
        }
      : null,
    state2d: has2D
      ? {
          elements: body.state2d.elements,
          bounds: body.state2d.bounds || null
        }
      : null,
    script,
    frontRotDeg
  };

  const dataJson = JSON.stringify(dataPayload);
  if (Buffer.byteLength(dataJson, 'utf8') > MAX_PAYLOAD_BYTES) {
    return { error: 'Dữ liệu hình khối quá lớn (tối đa 2MB).' };
  }

  return {
    name,
    author,
    dims,
    has3D,
    has2D,
    hasScript: Boolean(script.trim()),
    thumbnail,
    dataJson
  };
}

/**
 * Tạo handler cho `/api/models` (hỗ trợ inject dependencies khi chạy test).
 */
export function createModelsHandler(deps = {}) {
  const blobPut = deps.put || put;
  const blobList = deps.list || list;
  const blobDel = deps.del || del;
  const fetchFn = deps.fetch || globalThis.fetch;
  const getEnv = deps.getEnv || ((key) => process.env[key]);

  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
      return res.status(204).end();
    }

    const url = new URL(req.url || '/api/models', 'http://localhost');

    try {
      if (req.method === 'GET') {
        if (url.searchParams.get('verifyAdmin') === '1') {
          const adminPin = getEnv('ADMIN_PIN');
          if (!adminPin) {
            return res.status(503).json({
              ok: false,
              error: 'Chưa cấu hình biến môi trường ADMIN_PIN trên Vercel.'
            });
          }
          const providedPin = getHeader(req, 'x-admin-pin') || '';
          if (!timingSafeEqualStr(providedPin, adminPin)) {
            return res.status(401).json({ ok: false, error: 'Mã PIN Admin không đúng.' });
          }
          return res.status(200).json({ ok: true });
        }

        const { blobs } = await blobList({ prefix: 'cad-meta/', limit: 200 });
        const metaResults = await Promise.all(
          blobs.map(async (blob) => {
            try {
              const r = await fetchFn(blob.url);
              if (!r.ok) return null;
              const json = await r.json();
              return toPublicMeta(json);
            } catch {
              return null;
            }
          })
        );

        const models = metaResults
          .filter(Boolean)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ models });
      }

      if (req.method === 'POST') {
        if (getEnv('ALLOW_PUBLIC_SAVE') === 'false') {
          return res.status(403).json({
            error: 'Chức năng lưu công khai hiện đang tạm khóa bởi quản trị viên.'
          });
        }

        let body;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          const status = err.statusCode || 400;
          return res.status(status).json({ error: err.message || 'JSON không hợp lệ.' });
        }

        const validated = validateCreatePayload(body);
        if (validated.error) {
          return res.status(400).json({ error: validated.error });
        }

        const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const deleteToken = crypto.randomBytes(24).toString('hex');
        const createdAt = Date.now();

        const dataBlob = await blobPut(`cad-data/${id}.json`, validated.dataJson, {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json'
        });

        const metaRecord = {
          id,
          name: validated.name,
          author: validated.author,
          dims: validated.dims,
          has3D: validated.has3D,
          has2D: validated.has2D,
          hasScript: validated.hasScript,
          thumbnail: validated.thumbnail,
          dataUrl: dataBlob.url,
          createdAt,
          deleteTokenHash: sha256Hex(deleteToken)
        };

        await blobPut(`cad-meta/${id}.json`, JSON.stringify(metaRecord), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json'
        });

        // Thay thế các mẫu cũ cùng tên (không phân biệt hoa/thường) trên thư viện chung
        const normalizedNewName = validated.name.trim().toLowerCase();
        const replacedIds = [];
        try {
          const { blobs: existingMetaBlobs } = await blobList({ prefix: 'cad-meta/', limit: 200 });
          const urlsToDelete = [];
          await Promise.all(
            existingMetaBlobs.map(async (blob) => {
              if (blob.pathname === `cad-meta/${id}.json`) return;
              try {
                const r = await fetchFn(blob.url);
                if (!r.ok) return;
                const oldMeta = await r.json();
                const oldName = typeof oldMeta?.name === 'string' ? oldMeta.name.trim().toLowerCase() : '';
                if (oldName && oldName === normalizedNewName && oldMeta.id !== id) {
                  replacedIds.push(oldMeta.id);
                  urlsToDelete.push(blob.url);
                  if (oldMeta.dataUrl) {
                    urlsToDelete.push(oldMeta.dataUrl);
                  } else if (oldMeta.id) {
                    const { blobs: oldDataBlobs } = await blobList({ prefix: `cad-data/${oldMeta.id}.json`, limit: 2 });
                    oldDataBlobs.forEach((db) => urlsToDelete.push(db.url));
                  }
                }
              } catch {
                // Ignore corrupted meta blob
              }
            })
          );
          if (urlsToDelete.length > 0) {
            await blobDel(urlsToDelete);
          }
        } catch (cleanupErr) {
          console.warn('[api/models] Replace old same-name models warning:', cleanupErr);
        }

        return res.status(201).json({
          model: toPublicMeta(metaRecord),
          deleteToken,
          replacedIds
        });
      }

      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        if (!VALID_ID_REGEX.test(id)) {
          return res.status(400).json({ error: 'ID mẫu CAD không hợp lệ.' });
        }

        const adminPin = getEnv('ADMIN_PIN');
        const providedPin = getHeader(req, 'x-admin-pin') || '';
        const providedToken = getHeader(req, 'x-delete-token') || '';

        const isAdmin = Boolean(adminPin && providedPin && timingSafeEqualStr(providedPin, adminPin));
        let isAuthor = false;

        const [{ blobs: metaBlobs }, { blobs: dataBlobs }] = await Promise.all([
          blobList({ prefix: `cad-meta/${id}.json`, limit: 5 }),
          blobList({ prefix: `cad-data/${id}.json`, limit: 5 })
        ]);

        const targetUrls = [...metaBlobs, ...dataBlobs].map((b) => b.url);
        if (targetUrls.length === 0) {
          return res.status(404).json({ error: 'Không tìm thấy mẫu CAD cần xóa.' });
        }

        if (!isAdmin && providedToken && metaBlobs[0]) {
          try {
            const metaRes = await fetchFn(metaBlobs[0].url);
            if (metaRes.ok) {
              const metaJson = await metaRes.json();
              if (
                metaJson?.deleteTokenHash &&
                timingSafeEqualStr(sha256Hex(providedToken), metaJson.deleteTokenHash)
              ) {
                isAuthor = true;
              }
            }
          } catch {
            isAuthor = false;
          }
        }

        if (!isAdmin && !isAuthor) {
          if (providedPin && !adminPin) {
            return res.status(503).json({
              error: 'Chưa cấu hình biến môi trường ADMIN_PIN trên Vercel.'
            });
          }
          return res.status(401).json({
            error: 'Chỉ người tạo bài này hoặc Admin mới có quyền xóa.'
          });
        }

        await blobDel(targetUrls);
        return res.status(200).json({ deleted: true, id });
      }

      res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
      return res.status(405).json({ error: `Method ${req.method} not allowed.` });
    } catch (err) {
      console.error('[api/models] Error:', err);
      const msg = err?.message || 'Lỗi máy chủ khi xử lý thư viện CAD.';
      const needsTokenHint = /BLOB_READ_WRITE_TOKEN|No token found/i.test(msg);
      return res.status(500).json({
        error: needsTokenHint
          ? 'Chưa gắn Vercel Blob Storage (thiếu BLOB_READ_WRITE_TOKEN trên Vercel).'
          : msg
      });
    }
  };
}

export default createModelsHandler();
