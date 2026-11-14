/**
 * AI Assistant Module for My_CAD
 * Tích hợp Google Gemini Vision & Language API
 * Hỗ trợ phân tích ảnh bản vẽ / bài tập kỹ thuật và sinh mã CAD Script chạy trực tiếp trên OpenCASCADE B-Rep.
 */
import { executeCadScript } from './cad-script.js';

export class AIAssistant {
  constructor(cadEngine, callbacks = {}) {
    this.cad = cadEngine;
    this.callbacks = callbacks;
    this.selectedImageBase64 = null;
    this.selectedImageMime = null;

    this.modal = document.getElementById('ai-modal');
    this.btnOpen = document.getElementById('btn-open-ai-modal');
    this.btnClose = document.getElementById('btn-close-ai');
    this.uploadZone = document.getElementById('ai-upload-zone');
    this.fileInput = document.getElementById('ai-image-input');
    this.promptInput = document.getElementById('ai-prompt-input');
    this.apiKeyInput = document.getElementById('ai-api-key');
    this.btnSaveKey = document.getElementById('btn-save-ai-key');
    this.btnGenerate = document.getElementById('btn-generate-ai-cad');
    this.statusMsg = document.getElementById('ai-status-msg');
    this.previewBox = document.getElementById('ai-image-preview-container');
    this.previewImg = document.getElementById('ai-image-preview');
    this.btnRemoveImg = document.getElementById('btn-remove-ai-image');
    this.uploadPrompt = document.getElementById('ai-upload-prompt');

    this.init();
  }

  init() {
    // Load saved API key
    try {
      const savedKey = localStorage.getItem('mycad_gemini_api_key');
      if (savedKey && this.apiKeyInput) {
        this.apiKeyInput.value = savedKey;
      }
    } catch (e) {}

    // Event listeners
    this.btnOpen?.addEventListener('click', () => this.open());
    this.btnClose?.addEventListener('click', () => this.close());

    this.btnSaveKey?.addEventListener('click', () => {
      const key = this.apiKeyInput?.value?.trim();
      if (!key) {
        this.showStatus('Vui lòng nhập API Key trước khi lưu', 'error');
        return;
      }
      try {
        localStorage.setItem('mycad_gemini_api_key', key);
        this.showStatus('✓ Đã lưu API Key an toàn trong trình duyệt!', 'success');
      } catch (e) {
        this.showStatus('Không thể lưu vào localStorage', 'error');
      }
    });

    // Image Upload
    this.uploadPrompt?.addEventListener('click', () => this.fileInput?.click());
    this.fileInput?.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) this.handleImageFile(file);
    });

    // Drag and Drop
    this.uploadZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.uploadZone.classList.add('dragover');
    });
    this.uploadZone?.addEventListener('dragleave', () => {
      this.uploadZone.classList.remove('dragover');
    });
    this.uploadZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        this.handleImageFile(file);
      }
    });

    this.btnRemoveImg?.addEventListener('click', () => {
      this.selectedImageBase64 = null;
      this.selectedImageMime = null;
      if (this.fileInput) this.fileInput.value = '';
      if (this.previewBox) this.previewBox.style.display = 'none';
      if (this.uploadPrompt) this.uploadPrompt.style.display = 'block';
    });

    this.btnGenerate?.addEventListener('click', () => this.generateCAD());
  }

  open() {
    if (this.modal) {
      this.modal.style.display = 'flex';
      this.statusMsg.style.display = 'none';
    }
  }

  close() {
    if (this.modal) this.modal.style.display = 'none';
  }

  showStatus(text, type = 'info') {
    if (!this.statusMsg) return;
    this.statusMsg.textContent = text;
    this.statusMsg.style.display = 'block';
    this.statusMsg.className = `ai-status-msg ai-status-${type}`;
  }

  handleImageFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showStatus('Vui lòng chọn file hình ảnh (PNG, JPG, WEBP)!', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      this.selectedImageMime = file.type;
      this.selectedImageBase64 = dataUrl.split(',')[1];

      if (this.previewImg) this.previewImg.src = dataUrl;
      if (this.previewBox) this.previewBox.style.display = 'flex';
      if (this.uploadPrompt) this.uploadPrompt.style.display = 'none';
      this.showStatus(`✓ Đã nạp ảnh: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'success');
    };
    reader.readAsDataURL(file);
  }

  async generateCAD() {
    let apiKey = this.apiKeyInput?.value?.trim();
    if (!apiKey) {
      try {
        apiKey = localStorage.getItem('mycad_gemini_api_key');
      } catch (e) {}
    }

    if (!apiKey) {
      this.showStatus('Vui lòng dán Gemini API Key để sử dụng tính năng AI (hoàn toàn miễn phí từ Google AI Studio)!', 'error');
      return;
    }

    const promptText = this.promptInput?.value?.trim() || '';
    if (!this.selectedImageBase64 && !promptText) {
      this.showStatus('Vui lòng tải ảnh bản vẽ hoặc nhập mô tả khối bạn muốn dựng!', 'error');
      return;
    }

    this.btnGenerate.disabled = true;
    const prevBtnText = this.btnGenerate.textContent;
    this.btnGenerate.textContent = '⏳ AI đang phân tích & viết code CAD...';
    this.showStatus('Đang gửi dữ liệu đến Gemini AI...', 'info');

    try {
      const systemPrompt = `You are an expert mechanical CAD designer and programmer for "My_CAD", a 3D CAD application powered by OpenCASCADE B-Rep via replicad.
Your task is to analyze the user's technical drawing image and/or prompt instructions, read all dimensions (width, height, depth, hole diameters, fillets, slots, chamfers), and generate high-precision, executable JavaScript CAD script code.

The script MUST use only the following available DSL functions:
- box(w, h, d): Creates a box centered at (0,0,0) with dimensions w x h x d (along X, Y, Z).
- roundBox(w, h, d, r): Creates a box with filleted edges of radius r.
- cylinder(r, h, axis = 'y'): Cylinder with radius r and height h along 'x', 'y', or 'z' axis (centered at origin).
- tube(rOuter, rInner, h, axis = 'y'): Hollow cylinder / pipe with outer radius rOuter and inner radius rInner.
- move(target, x, y, z): Translates the 3D shape by (x, y, z).
- rotate(target, rxDeg, ryDeg, rzDeg): Rotates the 3D shape in degrees around X, Y, Z axes.
- union(...items): Fuses multiple shapes together (CSG Union).
- cut(target, ...cutters): Subtracts one or more cutters from the target (CSG Difference).
- intersect(target, ...others): Intersection of shapes.
- fillet(target, radius): Rounds all sharp edges by radius.
- chamfer(target, dist): Chamfers edges by distance.

CRITICAL RULES:
1. Always write clear, well-commented JavaScript code.
2. Calculate coordinates cleanly so parts align correctly.
3. The script must return the final solid object using: "return result;".
4. Put the pure JavaScript code inside a single markdown code block:
\`\`\`javascript
// Your code here
return shape;
\`\`\`
Do not include HTML or imports. Return only the executable CAD script.`;

      const contents = [];
      const parts = [];

      if (this.selectedImageBase64) {
        parts.push({
          inline_data: {
            mime_type: this.selectedImageMime || 'image/jpeg',
            data: this.selectedImageBase64
          }
        });
      }

      const userText = promptText
        ? `Hãy phân tích hình ảnh và mô tả sau đây để dựng khối 3D:\n${promptText}`
        : 'Hãy phân tích hình ảnh bản vẽ kỹ thuật này, nhận diện các hình chiếu (đứng, bằng, cạnh) và các kích thước chi tiết, sau đó viết mã CAD script để dựng lại mô hình 3D chính xác nhất.';

      parts.push({ text: userText });
      contents.push({ role: 'user', parts });

      const requestBody = {
        contents,
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2500
        }
      };

      // Call Gemini API (First try 2.5-flash, fallback to 1.5-flash)
      let response = null;
      const models = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.0-flash'];

      for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        try {
          this.showStatus(`Đang gọi mô hình ${model}...`, 'info');
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
          });
          if (res.ok) {
            response = await res.json();
            break;
          } else {
            console.warn(`Model ${model} returned error status:`, res.status);
          }
        } catch (e) {
          console.warn(`Model ${model} fetch failed:`, e);
        }
      }

      if (!response) {
        throw new Error('Không thể kết nối đến Gemini API. Vui lòng kiểm tra lại API Key hoặc kết nối mạng.');
      }

      const candidate = response.candidates?.[0];
      const textOutput = candidate?.content?.parts?.[0]?.text;

      if (!textOutput) {
        throw new Error('AI không trả về nội dung code hợp lệ.');
      }

      // Extract javascript code from markdown
      const codeMatch = textOutput.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
      const cadCode = codeMatch ? codeMatch[1].trim() : textOutput.trim();

      // Put code into CAD script editor
      const scriptInput = document.getElementById('cad-script-input');
      if (scriptInput) {
        scriptInput.value = cadCode;
      }

      this.showStatus('⏳ Đang biên dịch code sang khối 3D B-Rep thực tế...', 'info');

      // Execute code immediately
      const bounds = this.callbacks.getBounds ? this.callbacks.getBounds() : { w: 6, h: 4, d: 4 };
      const { brush, w, h, d } = await executeCadScript(cadCode, this.cad, bounds);

      if (this.callbacks.onModelCreated) {
        this.callbacks.onModelCreated(brush, w, h, d);
      }

      this.showStatus('🎉 Dựng khối 3D từ ảnh/mô tả thành công!', 'success');
      setTimeout(() => {
        this.close();
      }, 1000);

    } catch (err) {
      console.error('AI CAD generation error:', err);
      this.showStatus(`Lỗi: ${err.message || err}`, 'error');
    } finally {
      this.btnGenerate.disabled = false;
      this.btnGenerate.textContent = prevBtnText;
    }
  }
}
