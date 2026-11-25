const API_ENDPOINT = '/api/models';
const OWN_TOKENS_KEY = 'mycad_cloud_own_tokens';
const ADMIN_PIN_SESSION_KEY = 'mycad_cloud_admin_pin';

function readOwnTokensMap() {
  try {
    const raw = localStorage.getItem(OWN_TOKENS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOwnTokensMap(map) {
  try {
    const entries = Object.entries(map).slice(-50);
    localStorage.setItem(OWN_TOKENS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Bỏ qua nếu localStorage bị chặn
  }
}

export function getOwnDeleteToken(id) {
  if (!id) return '';
  const map = readOwnTokensMap();
  return typeof map[id] === 'string' ? map[id] : '';
}

export function removeOwnDeleteToken(id) {
  if (!id) return;
  const map = readOwnTokensMap();
  if (map[id]) {
    delete map[id];
    writeOwnTokensMap(map);
  }
}

export function getStoredAdminPin() {
  try {
    return sessionStorage.getItem(ADMIN_PIN_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredAdminPin(pin) {
  try {
    if (pin) {
      sessionStorage.setItem(ADMIN_PIN_SESSION_KEY, pin);
    } else {
      sessionStorage.removeItem(ADMIN_PIN_SESSION_KEY);
    }
  } catch {
    // Bỏ qua nếu sessionStorage bị chặn
  }
}

async function parseApiJson(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const err = new Error(
      'API Thư viện Cloud chỉ hoạt động khi chạy trên Vercel (hoặc chạy lệnh "vercel dev" ở máy cá nhân).'
    );
    err.code = 'API_UNAVAILABLE';
    throw err;
  }
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error || `Lỗi máy chủ (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Lấy danh sách các bài CAD đã lưu trên Vercel Blob.
 */
export async function fetchCloudModels() {
  const res = await fetch(API_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  const data = await parseApiJson(res);
  return Array.isArray(data.models) ? data.models : [];
}

/**
 * Tải nội dung chi tiết (3D/2D/Script) của một mẫu CAD từ dataUrl.
 */
export async function loadCloudModelData(dataUrl) {
  const res = await fetch(dataUrl);
  if (!res.ok) {
    throw new Error(`Không tải được dữ liệu mẫu CAD (${res.status}).`);
  }
  return res.json();
}

/**
 * Lưu bài CAD mới lên Thư viện dùng chung.
 */
export async function saveCloudModel(payload) {
  const res = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await parseApiJson(res);
  if (data?.model?.id && data?.deleteToken) {
    const map = readOwnTokensMap();
    map[data.model.id] = data.deleteToken;
    writeOwnTokensMap(map);
  }
  return data.model;
}

/**
 * Xác thực mã PIN Admin với server trước khi bật chế độ xóa.
 */
export async function verifyAdminPin(pin) {
  const res = await fetch(`${API_ENDPOINT}?verifyAdmin=1`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-admin-pin': pin
    }
  });
  await parseApiJson(res);
  return true;
}

/**
 * Xóa một mẫu CAD khỏi Vercel Blob (bằng ADMIN_PIN hoặc deleteToken của bản thân).
 */
export async function deleteCloudModel(id, { adminPin = '', deleteToken = '' } = {}) {
  const headers = { Accept: 'application/json' };
  if (adminPin) headers['x-admin-pin'] = adminPin;
  if (deleteToken) headers['x-delete-token'] = deleteToken;

  const res = await fetch(`${API_ENDPOINT}?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers
  });
  const data = await parseApiJson(res);
  removeOwnDeleteToken(id);
  return data;
}

/**
 * Chụp ảnh thumbnail gọn (240x150) từ viewport Three.js mà không cần bật preserveDrawingBuffer toàn cục.
 */
export function captureViewportThumbnail(renderer, scene, camera) {
  if (!renderer || !scene || !camera) return '';
  try {
    renderer.render(scene, camera);
    const srcCanvas = renderer.domElement;
    if (!srcCanvas || srcCanvas.width === 0 || srcCanvas.height === 0) return '';

    const thumbW = 240;
    const thumbH = 150;
    const offscreen = document.createElement('canvas');
    offscreen.width = thumbW;
    offscreen.height = thumbH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, thumbW, thumbH);

    const srcAspect = srcCanvas.width / srcCanvas.height;
    const dstAspect = thumbW / thumbH;
    let drawW = thumbW;
    let drawH = thumbH;
    let dx = 0;
    let dy = 0;

    if (srcAspect > dstAspect) {
      drawH = thumbW / srcAspect;
      dy = (thumbH - drawH) / 2;
    } else {
      drawW = thumbH * srcAspect;
      dx = (thumbW - drawW) / 2;
    }
    ctx.drawImage(srcCanvas, dx, dy, drawW, drawH);

    const webp = offscreen.toDataURL('image/webp', 0.72);
    if (webp.startsWith('data:image/webp')) return webp;
    return offscreen.toDataURL('image/jpeg', 0.75);
  } catch {
    return '';
  }
}
