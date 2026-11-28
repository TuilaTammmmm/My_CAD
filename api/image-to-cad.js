/**
 * Serverless endpoint `/api/image-to-cad`
 * Converts a 2D orthographic / 3-view CAD drawing image into executable CAD Script
 * using Gemini Vision API (`GEMINI_API_KEY`).
 */

const CAD_SCRIPT_SYSTEM_PROMPT = `Bạn là chuyên gia kỹ thuật CAD 3D (OpenCascade / replicad).
Nhiệm vụ: Đọc ảnh bản vẽ kỹ thuật 2D (thường gồm 3 hình chiếu: Hình chiếu Đứng ở trên-trái, Hình chiếu Bằng ở dưới-trái, Hình chiếu Cạnh ở trên-phải, kèm nét thấy, nét khuất đứt đoạn và đường tâm) và viết ra đoạn mã JavaScript CAD Script để dựng lại chính xác khối 3D đó.

QUY ƯỚC HỆ TỌA ĐỘ & HÀM CAD SCRIPT:
- Hệ tọa độ Y-up, khối mặc định đặt tâm tại (0, 0, 0).
  + W (chiều rộng theo trục X), H (chiều cao theo trục Y), D (chiều sâu theo trục Z).
  + Hình chiếu Đứng nhìn từ +Z (thấy trục X ngang, trục Y dọc).
  + Hình chiếu Bằng nhìn từ +Y xuống (thấy trục X ngang, trục Z dọc).
  + Hình chiếu Cạnh nhìn từ +X hoặc -X (thấy trục Z ngang, trục Y dọc).
- Các hàm tạo khối có sẵn (đều hỗ trợ chain method):
  + hop(w, h, d) : Tạo khối hộp chữ nhật tâm (0,0,0).
  + hop_bo(w, h, d, r) : Tạo khối hộp bo tròn các cạnh.
  + tru(r, h, axis) : Tạo hình trụ tròn bán kính r, cao h, theo trục 'x' | 'y' | 'z' (mặc định 'y').
  + ong(rNgoai, rTrong, h, axis) : Tạo ống trụ rỗng.
  + poly(points2D, depth, axis) : Đùn đa giác 2D [[u1,v1],[u2,v2],...] với độ dày depth theo trục 'z' | 'x' | 'y'. (Với 'z', u là X, v là Y; với 'x', u là Z, v là Y; với 'y', u là X, v là Z).
- Các phép biến đổi & Boolean (trả về khối mới):
  + .dich(x, y, z) : Tịnh tiến khối theo (x, y, z).
  + .xoay(rx, ry, rz) : Xoay khối theo độ.
  + .cat(dao1, dao2, ...) hoặc cut(a, b) : Khoét / cắt bớt khối dao.
  + .ghep(k1, k2, ...) hoặc union(a, b) : Ghép / hợp nhất nhiều khối.
  + .bo(r) : Bo tròn tất cả cạnh (cẩn thận r nhỏ hơn nửa độ dày).
  + .vat(d) : Vát mép cạnh.
- BẮT BUỘC: Cuối script phải có lệnh \`return <ten_bien_khoi>;\`.
- KHÔNG dùng import/export, KHÔNG bọc markdown \`\`\`js, chỉ trả về code JavaScript thuần túy sạch sẽ, có comment ngắn tiếng Việt.`;

function stripCodeFences(text) {
  let out = String(text || '').trim();
  const fenceMatch = out.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    out = fenceMatch[1].trim();
  }
  return out;
}

export function createImageToCadHandler(deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const getEnv = deps.getEnv || ((key) => process.env[key]);

  return async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(204).end();
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return res.status(405).json({ error: `Method ${req.method} not allowed.` });
    }

    try {
      let body = req.body;
      if (typeof body === 'string') {
        body = JSON.parse(body);
      } else if (!body) {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      }

      const image = body?.image;
      if (typeof image !== 'string' || !image.startsWith('data:image/')) {
        return res.status(400).json({ error: 'Vui lòng gửi ảnh hợp lệ (PNG/JPG/WebP).' });
      }

      const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Định dạng ảnh base64 không hợp lệ.' });
      }
      const mimeType = match[1];
      const base64Data = match[2];

      const apiKey = (body?.apiKey && String(body.apiKey).trim()) || getEnv('GEMINI_API_KEY');
      if (!apiKey) {
        return res.status(503).json({
          error: 'Chưa cấu hình GEMINI_API_KEY trên Vercel (hoặc nhập API Key Gemini của bạn).'
        });
      }

      const targetW = Number(body?.targetWidth) > 0 ? Number(body.targetWidth) : 60;
      const userPrompt = `Hãy phân tích kỹ bản vẽ 2D này (3 hình chiếu Đứng - Bằng - Cạnh, chú ý các nét khuất đứt đoạn, lỗ tròn, vát chéo, giật bậc) và viết CAD Script dựng lại khối 3D.
Quy chuẩn chiều rộng tổng thể (trục X) khoảng ${targetW} đơn vị, các chiều cao H và sâu D tỉ lệ chính xác theo hình vẽ.
Chỉ trả về mã JavaScript CAD Script thuần túy, kết thúc bằng \`return ...\`.`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
      const apiRes = await fetchFn(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CAD_SCRIPT_SYSTEM_PROMPT }] },
          contents: [
            {
              role: 'user',
              parts: [
                { text: userPrompt },
                { inlineData: { mimeType, data: base64Data } }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2
          }
        })
      });

      const apiJson = await apiRes.json();
      if (!apiRes.ok) {
        const msg = apiJson?.error?.message || `Gemini API lỗi (${apiRes.status})`;
        return res.status(apiRes.status >= 400 && apiRes.status < 500 ? apiRes.status : 502).json({ error: msg });
      }

      const rawText = apiJson?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
      const script = stripCodeFences(rawText);
      if (!script) {
        return res.status(502).json({ error: 'AI không trả về mã CAD Script hợp lệ.' });
      }

      return res.status(200).json({ script });
    } catch (err) {
      console.error('[api/image-to-cad] Error:', err);
      return res.status(500).json({ error: err?.message || 'Lỗi xử lý ảnh sang CAD Script.' });
    }
  };
}

export default createImageToCadHandler();
