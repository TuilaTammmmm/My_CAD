import { DXFExporter } from './dxf-exporter.js';

/**
 * CAD2DEditor
 * Không gian làm việc Bản Vẽ 2D Kỹ Thuật (3 Hình Chiếu Vuông Góc: Đứng - Bằng - Cạnh)
 * Hỗ trợ vẽ/sửa nét 2D, đối chiếu đường dóng 45 độ và xuất file AutoCAD (.DXF)
 */
export class CAD2DEditor {
  constructor(container, projectionEngine, onSwitchTo3D) {
    this.container = container;
    this.projectionEngine = projectionEngine;
    this.onSwitchTo3D = onSwitchTo3D;

    this.isVisible = false;
    this.currentBrush = null;
    this.bounds = { w: 6, h: 4, d: 4 };

    // Dữ liệu 3 hình chiếu { front, top, side }
    this.drawingData = {
      front: { visible: [], hidden: [] },
      top: { visible: [], hidden: [] },
      side: { visible: [], hidden: [] },
      bounds: this.bounds,
      customLines: [] // Các nét do người dùng vẽ thêm
    };

    // Lịch sử thao tác 2D
    this.history = [];
    this.historyIndex = -1;

    // Viewport transform (Pan & Zoom)
    this.scale = 26; // pixels per grid unit
    this.offsetX = 120;
    this.offsetY = 100;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Chế độ thao tác 2D: 'select', 'draw-visible', 'draw-hidden', 'erase'
    this.tool = 'select';
    this.showRays = true;
    this.showGrid = true;

    // Điểm vẽ tạm thời khi click
    this.pendingPoint = null;
    this.hoverSnap = null;

    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    this.wrapper = document.createElement('div');
    this.wrapper.id = 'cad2d-wrapper';
    this.wrapper.className = 'cad2d-wrapper';
    this.wrapper.style.display = 'none';

    this.wrapper.innerHTML = `
      <!-- THANH ĐIỀU KHIỂN BẢN VẼ 2D -->
      <header class="cad2d-topbar">
        <div class="cad2d-brand">
          <button class="btn-switch-3d" id="btn-back-to-3d" title="Quay lại không gian 3D Block CAD">
            <svg viewBox="0 0 24 24"><path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/><line x1="12" y1="22" x2="12" y2="12"/><line x1="21" y1="7" x2="12" y2="12"/><line x1="3" y1="7" x2="12" y2="12"/></svg>
            <span>🧊 QUAY LẠI 3D CAD</span>
          </button>
          <div class="cad2d-title-block">
            <span class="cad2d-title">📐 BẢN VẼ 2D (3 HÌNH CHIẾU)</span>
            <span class="cad2d-sub">Chuẩn TCVN / ISO - Sẵn sàng cho AutoCAD</span>
          </div>
        </div>

        <div class="cad2d-tool-group">
          <button class="cad2d-btn active" data-tool="select" title="Quan sát, Di chuyển & Phóng to bản vẽ">✋ Di Chuyển</button>
          <button class="cad2d-btn" data-tool="draw-visible" title="Vẽ thêm nét thấy (Nét liền đậm)">✏️ Vẽ Nét Thấy</button>
          <button class="cad2d-btn" data-tool="draw-hidden" title="Vẽ thêm nét khuất (Nét đứt)">📏 Vẽ Nét Khuất</button>
          <button class="cad2d-btn" data-tool="erase" title="Click vào nét để xóa">✂️ Xóa Nét</button>
        </div>

        <div class="cad2d-tool-group">
          <button class="cad2d-btn-toggle active" id="btn-toggle-rays" title="Bật/Tắt đường dóng liên hệ và góc 45°">📐 Đường Dóng 45°</button>
          <button class="cad2d-btn-toggle active" id="btn-toggle-2dgrid" title="Bật/Tắt lưới bắt dính ô">▦ Lưới Ô</button>
          <button class="cad2d-btn" id="btn-sync-3d" title="Tải lại các hình chiếu từ khối 3D gốc">🔄 Cập Nhật 3D</button>
          <button class="cad2d-btn btn-export-dxf" id="btn-export-dxf" title="Xuất file DXF mở trực tiếp bằng AutoCAD">💾 XUẤT AUTOCAD (.DXF)</button>
        </div>
      </header>

      <!-- KHÔNG GIAN BẢN VẼ CANVAS -->
      <div class="cad2d-canvas-container" id="cad2d-canvas-container">
        <canvas id="cad2d-canvas"></canvas>
      </div>

      <!-- THANH CHÚ THÍCH HƯỚNG DẪN 2D -->
      <div class="cad2d-footer-info">
        <span>🟢 <b>Hình chiếu Đứng:</b> Góc trên trái</span>
        <span>🔵 <b>Hình chiếu Bằng:</b> Góc dưới trái</span>
        <span>🟡 <b>Hình chiếu Cạnh:</b> Góc trên phải</span>
        <span>👉 <i>Cuộn chuột để Phóng to/Thu nhỏ, Kéo chuột để Di chuyển</i></span>
      </div>
    `;

    this.container.appendChild(this.wrapper);
    this.canvas = document.getElementById('cad2d-canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  bindEvents() {
    // Nút quay lại 3D
    const btnBack = document.getElementById('btn-back-to-3d');
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        if (this.onSwitchTo3D) this.onSwitchTo3D();
      });
    }

    // Nút công cụ vẽ/sửa
    this.wrapper.querySelectorAll('.cad2d-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.tool = btn.getAttribute('data-tool');
        this.pendingPoint = null;
        this.wrapper.querySelectorAll('.cad2d-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.render();
      });
    });

    // Bật tắt đường dóng
    const btnRays = document.getElementById('btn-toggle-rays');
    if (btnRays) {
      btnRays.addEventListener('click', () => {
        this.showRays = !this.showRays;
        btnRays.classList.toggle('active', this.showRays);
        this.render();
      });
    }

    // Bật tắt lưới
    const btnGrid = document.getElementById('btn-toggle-2dgrid');
    if (btnGrid) {
      btnGrid.addEventListener('click', () => {
        this.showGrid = !this.showGrid;
        btnGrid.classList.toggle('active', this.showGrid);
        this.render();
      });
    }

    // Đồng bộ từ 3D
    const btnSync = document.getElementById('btn-sync-3d');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        this.syncFrom3D();
      });
    }

    // Xuất AutoCAD DXF
    const btnDxf = document.getElementById('btn-export-dxf');
    if (btnDxf) {
      btnDxf.addEventListener('click', () => {
        DXFExporter.downloadDXF(this.drawingData, `ban_ve_ky_thuat_${this.bounds.w}x${this.bounds.h}x${this.bounds.d}.dxf`);
      });
    }

    // Canvas Mouse events (Pan, Zoom, Snap, Draw)
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  show(brush, bounds) {
    this.isVisible = true;
    this.currentBrush = brush;
    this.bounds = bounds;
    this.wrapper.style.display = 'flex';
    this.resizeCanvas();
    this.syncFrom3D();
    this.centerView();
  }

  hide() {
    this.isVisible = false;
    this.wrapper.style.display = 'none';
  }

  syncFrom3D() {
    if (!this.currentBrush) return;
    const proj = this.projectionEngine.generateProjections(this.currentBrush, this.bounds);
    this.drawingData = {
      front: proj.front,
      top: proj.top,
      side: proj.side,
      bounds: this.bounds,
      customLines: this.drawingData.customLines || []
    };
    this.render();
  }

  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  centerView() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const { w, h, d } = this.bounds;
    const spacing = 3;
    const totalW = (w + spacing + d) * this.scale;
    const totalH = (h + spacing + d) * this.scale;

    this.offsetX = Math.round((rect.width - totalW) / 2);
    this.offsetY = Math.round((rect.height - totalH) / 2 + (h * this.scale));
    this.render();
  }

  // --- TỌA ĐỘ VÀ VÙNG CHIẾU TRÊN CANVAS ---
  getViewOrigins() {
    const { w, h, d } = this.bounds;
    const spacing = 3.5; // ô lưới khoảng cách

    // Tọa độ canvas (hướng trục Y canvas đi xuống)
    // Front View: (originX, originY)
    // Top View: (originX, originY + (h + spacing) * scale)
    // Side View: (originX + (w + spacing) * scale, originY)
    const frontOrigin = { x: this.offsetX, y: this.offsetY };
    const topOrigin = { x: this.offsetX, y: this.offsetY + (h + spacing) * this.scale };
    const sideOrigin = { x: this.offsetX + (w + spacing) * this.scale, y: this.offsetY };

    return { frontOrigin, topOrigin, sideOrigin, spacing };
  }

  // Chuyển tọa độ chuột thành tọa độ grid trong hình chiếu
  getSnapPoint(screenX, screenY) {
    const { frontOrigin, topOrigin, sideOrigin } = this.getViewOrigins();
    const { w, h, d } = this.bounds;
    const s = this.scale;

    // Kiểm tra chuột thuộc view nào
    const checkView = (orig, maxU, maxV, viewName) => {
      const uRaw = (screenX - orig.x) / s;
      const vRaw = -(screenY - orig.y) / s; // Y toán học hướng lên
      const uSnap = Math.round(uRaw);
      const vSnap = Math.round(vRaw);

      if (uSnap >= -0.1 && uSnap <= maxU + 0.1 && vSnap >= -0.1 && vSnap <= maxV + 0.1) {
        return {
          view: viewName,
          u: Math.max(0, Math.min(maxU, uSnap)),
          v: Math.max(0, Math.min(maxV, vSnap)),
          canvasX: orig.x + Math.max(0, Math.min(maxU, uSnap)) * s,
          canvasY: orig.y - Math.max(0, Math.min(maxV, vSnap)) * s
        };
      }
      return null;
    };

    return checkView(frontOrigin, w, h, 'front') ||
           checkView(topOrigin, w, d, 'top') ||
           checkView(sideOrigin, d, h, 'side');
  }

  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.button === 1 || this.tool === 'select' || (e.button === 0 && e.shiftKey)) {
      this.isPanning = true;
      this.panStart = { x: mouseX - this.offsetX, y: mouseY - this.offsetY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 0) {
      const snap = this.getSnapPoint(mouseX, mouseY);
      if (!snap) return;

      if (this.tool === 'draw-visible' || this.tool === 'draw-hidden') {
        if (!this.pendingPoint) {
          this.pendingPoint = snap;
        } else {
          if (this.pendingPoint.view === snap.view) {
            // Thêm nét vẽ vào danh sách
            this.drawingData.customLines.push({
              view: snap.view,
              type: (this.tool === 'draw-hidden') ? 'hidden' : 'visible',
              p1: { u: this.pendingPoint.u, v: this.pendingPoint.v },
              p2: { u: snap.u, v: snap.v }
            });
          }
          this.pendingPoint = null;
          this.render();
        }
      } else if (this.tool === 'erase') {
        // Xóa nét gần vị trí click
        this.eraseNear(snap);
      }
    }
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (this.isPanning) {
      this.offsetX = mouseX - this.panStart.x;
      this.offsetY = mouseY - this.panStart.y;
      this.render();
      return;
    }

    this.hoverSnap = this.getSnapPoint(mouseX, mouseY);
    this.render();
  }

  onMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = this.tool === 'select' ? 'grab' : 'crosshair';
    }
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
    const newScale = Math.max(12, Math.min(100, this.scale * zoomFactor));

    // Giữ nguyên vị trí chuột khi zoom
    this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
    this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
    this.scale = newScale;

    this.render();
  }

  eraseNear(snap) {
    if (!this.drawingData.customLines) return;
    const EPS = 0.5;
    this.drawingData.customLines = this.drawingData.customLines.filter(line => {
      if (line.view !== snap.view) return true;
      const d1 = Math.hypot(line.p1.u - snap.u, line.p1.v - snap.v);
      const d2 = Math.hypot(line.p2.u - snap.u, line.p2.v - snap.v);
      return d1 > EPS && d2 > EPS;
    });
    this.render();
  }

  // --- RENDER BẢN VẼ 2D ---
  render() {
    if (!this.isVisible || !this.ctx) return;

    const ctx = this.ctx;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const { w, h, d } = this.bounds;
    const s = this.scale;

    // 1. Nền bản vẽ kỹ thuật Dark CAD
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const { frontOrigin, topOrigin, sideOrigin, spacing } = this.getViewOrigins();

    // 2. Lưới ô bắt dính (Grid)
    if (this.showGrid) {
      this.drawViewGrid(ctx, frontOrigin, w, h, 'HÌNH CHIẾU ĐỨNG (Front)');
      this.drawViewGrid(ctx, topOrigin, w, d, 'HÌNH CHIẾU BẰNG (Top)');
      this.drawViewGrid(ctx, sideOrigin, d, h, 'HÌNH CHIẾU CẠNH (Side)');
    }

    // 3. Đường dóng liên hệ (Projection Rays) và góc 45 độ
    if (this.showRays) {
      this.drawProjectionRays(ctx, frontOrigin, topOrigin, sideOrigin, spacing);
    }

    // 4. Vẽ các hình chiếu (Nét Thấy & Nét Khuất)
    this.renderViewLines(ctx, frontOrigin, this.drawingData.front);
    this.renderViewLines(ctx, topOrigin, this.drawingData.top);
    this.renderViewLines(ctx, sideOrigin, this.drawingData.side);

    // 5. Vẽ các nét tùy chỉnh người dùng vẽ thêm
    if (this.drawingData.customLines) {
      for (const cl of this.drawingData.customLines) {
        const orig = (cl.view === 'front') ? frontOrigin : (cl.view === 'top') ? topOrigin : sideOrigin;
        this.drawLineSegment(ctx, orig, cl.p1, cl.p2, cl.type === 'hidden');
      }
    }

    // 6. Vẽ điểm bắt dính hover và điểm chờ click tiếp theo
    if (this.hoverSnap) {
      ctx.beginPath();
      ctx.arc(this.hoverSnap.canvasX, this.hoverSnap.canvasY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Tooltip tọa độ
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`(${this.hoverSnap.u}, ${this.hoverSnap.v})`, this.hoverSnap.canvasX + 8, this.hoverSnap.canvasY - 8);
    }

    if (this.pendingPoint) {
      ctx.beginPath();
      ctx.arc(this.pendingPoint.canvasX, this.pendingPoint.canvasY, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#f43f5e';
      ctx.fill();

      if (this.hoverSnap && this.hoverSnap.view === this.pendingPoint.view) {
        ctx.beginPath();
        ctx.moveTo(this.pendingPoint.canvasX, this.pendingPoint.canvasY);
        ctx.lineTo(this.hoverSnap.canvasX, this.hoverSnap.canvasY);
        ctx.strokeStyle = (this.tool === 'draw-hidden') ? '#eab308' : '#f43f5e';
        ctx.lineWidth = 2;
        if (this.tool === 'draw-hidden') ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Vẽ lưới từng hình chiếu
  drawViewGrid(ctx, origin, maxU, maxV, title) {
    const s = this.scale;

    // Tiêu đề hình chiếu
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(title, origin.x, origin.y - (maxV * s) - 10);

    // Lưới con
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (let u = 0; u <= maxU; u++) {
      ctx.beginPath();
      ctx.moveTo(origin.x + u * s, origin.y);
      ctx.lineTo(origin.x + u * s, origin.y - maxV * s);
      ctx.stroke();
    }
    for (let v = 0; v <= maxV; v++) {
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y - v * s);
      ctx.lineTo(origin.x + maxU * s, origin.y - v * s);
      ctx.stroke();
    }

    // Chấm nút lưới
    ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
    for (let u = 0; u <= maxU; u++) {
      for (let v = 0; v <= maxV; v++) {
        ctx.beginPath();
        ctx.arc(origin.x + u * s, origin.y - v * s, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Vẽ đường dóng liên hệ kỹ thuật
  drawProjectionRays(ctx, frontOrig, topOrig, sideOrig, spacing) {
    const { w, h, d } = this.bounds;
    const s = this.scale;

    ctx.strokeStyle = 'rgba(244, 63, 94, 0.3)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);

    // Dóng dọc giữa Chiếu Đứng và Chiếu Bằng
    ctx.beginPath();
    ctx.moveTo(frontOrig.x, frontOrig.y);
    ctx.lineTo(topOrig.x, topOrig.y - d * s);
    ctx.moveTo(frontOrig.x + w * s, frontOrig.y);
    ctx.lineTo(topOrig.x + w * s, topOrig.y - d * s);
    ctx.stroke();

    // Dóng ngang giữa Chiếu Đứng và Chiếu Cạnh
    ctx.beginPath();
    ctx.moveTo(frontOrig.x + w * s, frontOrig.y);
    ctx.lineTo(sideOrig.x, sideOrig.y);
    ctx.moveTo(frontOrig.x + w * s, frontOrig.y - h * s);
    ctx.lineTo(sideOrig.x, sideOrig.y - h * s);
    ctx.stroke();

    // Đường dóng bẻ góc 45 độ đối chiếu Chiếu Bằng sang Chiếu Cạnh
    const cornerX = frontOrig.x + (w + spacing) * s;
    const cornerY = frontOrig.y + spacing * s;

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.beginPath();
    ctx.moveTo(cornerX, cornerY);
    ctx.lineTo(cornerX + d * s, cornerY + d * s);
    ctx.stroke();

    ctx.setLineDash([]);
  }

  // Vẽ các đoạn nét thấy và nét khuất
  renderViewLines(ctx, origin, viewData) {
    if (!viewData) return;

    // 1. Nét khuất (Dashed line vàng)
    if (viewData.hidden) {
      for (const line of viewData.hidden) {
        this.drawLineSegment(ctx, origin, line.p1, line.p2, true);
      }
    }

    // 2. Nét thấy (Solid line trắng sáng 2.2px)
    if (viewData.visible) {
      for (const line of viewData.visible) {
        this.drawLineSegment(ctx, origin, line.p1, line.p2, false);
      }
    }
  }

  drawLineSegment(ctx, origin, p1, p2, isHidden) {
    const s = this.scale;
    const x1 = origin.x + p1.u * s;
    const y1 = origin.y - p1.v * s;
    const x2 = origin.x + p2.u * s;
    const y2 = origin.y - p2.v * s;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);

    if (isHidden) {
      ctx.strokeStyle = '#facc15'; // Nét đứt vàng
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = '#f8fafc'; // Nét liền trắng đậm
      ctx.lineWidth = 2.4;
      ctx.setLineDash([]);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }
}
