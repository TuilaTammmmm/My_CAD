import { DXFExporter } from './dxf-exporter.js';

/**
 * CAD2DEditor
 * Trình vẽ 2D kỹ thuật trực tiếp trên MẶT PHẲNG ĐƠN (Đứng / Bằng / Cạnh)
 * Dùng chung sidebar với 3D, tích hợp bắt dính ô lưới, vẽ nét thấy, nét khuất và xuất AutoCAD .DXF
 */
export class CAD2DEditor {
  constructor(canvasElement, projectionEngine) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.projectionEngine = projectionEngine;

    this.isVisible = false;
    this.currentBrush = null;
    this.bounds = { w: 6, h: 4, d: 4 };

    // Mặt phẳng hiện tại đang vẽ: 'front' (W x H), 'top' (W x D), 'side' (D x H)
    this.activePlane = 'front';

    // Dữ liệu nét vẽ theo từng mặt phẳng
    this.planesData = {
      front: { visible: [], hidden: [] },
      top: { visible: [], hidden: [] },
      side: { visible: [], hidden: [] }
    };

    // Công cụ hiện tại: 'draw-visible', 'draw-hidden', 'erase', 'pan'
    this.tool = 'draw-visible';

    // Biến đổi Viewport (Pan & Zoom)
    this.scale = 42; // pixels / unit
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Điểm chờ click vẽ nét (Point 1 -> Point 2)
    this.pendingPoint = null;
    this.hoverSnap = null;

    this.bindCanvasEvents();
  }

  // Kích thước mặt phẳng hiện tại
  getPlaneDimensions() {
    const { w, h, d } = this.bounds;
    if (this.activePlane === 'front') return { maxU: w, maxV: h, title: 'MẶT ĐỨNG (Front: X-Y)' };
    if (this.activePlane === 'top') return { maxU: w, maxV: d, title: 'MẶT BẰNG (Top: X-Z)' };
    return { maxU: d, maxV: h, title: 'MẶT CẠNH (Side: Z-Y)' };
  }

  setPlane(planeName) {
    this.activePlane = planeName;
    this.pendingPoint = null;
    this.centerPlane();
    this.render();
  }

  setTool(toolName) {
    this.tool = toolName;
    this.pendingPoint = null;
    this.canvas.style.cursor = (this.tool === 'pan') ? 'grab' : 'crosshair';
    this.render();
  }

  show(brush, bounds) {
    this.isVisible = true;
    this.currentBrush = brush;
    this.bounds = bounds;
    this.canvas.parentElement.style.display = 'block';
    this.resize();
    this.centerPlane();
    this.render();
  }

  hide() {
    this.isVisible = false;
    this.canvas.parentElement.style.display = 'none';
  }

  syncFrom3D() {
    if (!this.currentBrush) return;
    const { maxU, maxV } = this.getPlaneDimensions();
    const proj = this.projectionEngine.generateProjections(this.currentBrush, this.bounds);

    if (proj[this.activePlane]) {
      this.planesData[this.activePlane] = {
        visible: [...proj[this.activePlane].visible],
        hidden: [...proj[this.activePlane].hidden]
      };
    }
    this.render();
  }

  clearPlane() {
    this.planesData[this.activePlane] = { visible: [], hidden: [] };
    this.pendingPoint = null;
    this.render();
  }

  exportDXF() {
    const data = this.planesData[this.activePlane];
    const { title } = this.getPlaneDimensions();
    DXFExporter.downloadPlaneDXF({
      visibleLines: data.visible,
      hiddenLines: data.hidden,
      planeName: title,
      bounds: this.bounds
    }, `ban_ve_2d_${this.activePlane}_${this.bounds.w}x${this.bounds.h}x${this.bounds.d}.dxf`);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  centerPlane() {
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const { maxU, maxV } = this.getPlaneDimensions();

    const planePixelW = maxU * this.scale;
    const planePixelH = maxV * this.scale;

    // Đặt mặt phẳng ở vị trí trung tâm, chừa chỗ cho sidebar bên trái
    this.offsetX = Math.round((rect.width - planePixelW) / 2 + 50);
    this.offsetY = Math.round((rect.height + planePixelH) / 2);
  }

  // --- TỌA ĐỘ VÀ BẮT DÍNH Ô LƯỚI ---
  getSnapPoint(screenX, screenY) {
    const { maxU, maxV } = this.getPlaneDimensions();
    const s = this.scale;

    const uRaw = (screenX - this.offsetX) / s;
    const vRaw = -(screenY - this.offsetY) / s; // Y hướng lên

    const uSnap = Math.round(uRaw);
    const vSnap = Math.round(vRaw);

    if (uSnap >= -0.2 && uSnap <= maxU + 0.2 && vSnap >= -0.2 && vSnap <= maxV + 0.2) {
      const u = Math.max(0, Math.min(maxU, uSnap));
      const v = Math.max(0, Math.min(maxV, vSnap));
      return {
        u, v,
        canvasX: this.offsetX + u * s,
        canvasY: this.offsetY - v * s
      };
    }
    return null;
  }

  bindCanvasEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.button === 1 || this.tool === 'pan' || (e.button === 0 && e.shiftKey)) {
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
            // Đã có điểm 1, điểm 2 hoàn tất đoạn thẳng
            if (this.pendingPoint.u !== snap.u || this.pendingPoint.v !== snap.v) {
              const targetList = (this.tool === 'draw-hidden') ?
                this.planesData[this.activePlane].hidden :
                this.planesData[this.activePlane].visible;

              targetList.push({
                p1: { u: this.pendingPoint.u, v: this.pendingPoint.v },
                p2: { u: snap.u, v: snap.v }
              });
            }
            this.pendingPoint = null;
            this.render();
          }
        } else if (this.tool === 'erase') {
          this.eraseNear(snap);
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isVisible) return;
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
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = (this.tool === 'pan') ? 'grab' : 'crosshair';
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(16, Math.min(120, this.scale * factor));

      this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
      this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;

      this.render();
    }, { passive: false });

    window.addEventListener('resize', () => {
      if (this.isVisible) this.resize();
    });
  }

  eraseNear(snap) {
    const data = this.planesData[this.activePlane];
    const EPS = 0.45;

    const filterFn = (line) => {
      const d1 = Math.hypot(line.p1.u - snap.u, line.p1.v - snap.v);
      const d2 = Math.hypot(line.p2.u - snap.u, line.p2.v - snap.v);
      return d1 > EPS && d2 > EPS;
    };

    data.visible = data.visible.filter(filterFn);
    data.hidden = data.hidden.filter(filterFn);
    this.render();
  }

  // --- VẼ MẶT PHẲNG 2D ---
  render() {
    if (!this.isVisible || !this.ctx) return;

    const ctx = this.ctx;
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const { maxU, maxV, title } = this.getPlaneDimensions();
    const s = this.scale;

    // Nền tối CAD sang trọng
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // 1. Khung trang giấy bao quanh mặt phẳng
    const margin = 1.5 * s;
    const planeLeft = this.offsetX;
    const planeTop = this.offsetY - maxV * s;
    const planeW = maxU * s;
    const planeH = maxV * s;

    // Nền vùng mặt phẳng vẽ (màu than chì kỹ thuật)
    ctx.fillStyle = '#111827';
    ctx.fillRect(planeLeft, planeTop, planeW, planeH);

    // Viền khung mặt phẳng
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(planeLeft, planeTop, planeW, planeH);

    // 2. Lưới ô bắt dính (Grid)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (let u = 0; u <= maxU; u++) {
      ctx.beginPath();
      ctx.moveTo(this.offsetX + u * s, this.offsetY);
      ctx.lineTo(this.offsetX + u * s, this.offsetY - maxV * s);
      ctx.stroke();
    }
    for (let v = 0; v <= maxV; v++) {
      ctx.beginPath();
      ctx.moveTo(this.offsetX, this.offsetY - v * s);
      ctx.lineTo(this.offsetX + maxU * s, this.offsetY - v * s);
      ctx.stroke();
    }

    // Chấm nút lưới và số đo trục
    ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let u = 0; u <= maxU; u++) {
      ctx.fillText(u, this.offsetX + u * s, this.offsetY + 5);
      for (let v = 0; v <= maxV; v++) {
        ctx.beginPath();
        ctx.arc(this.offsetX + u * s, this.offsetY - v * s, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= maxV; v++) {
      ctx.fillText(v, this.offsetX - 7, this.offsetY - v * s);
    }

    // Tiêu đề mặt phẳng vẽ
    ctx.font = 'bold 15px -apple-system, sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'left';
    ctx.fillText(`📐 ${title}`, planeLeft, planeTop - 14);

    // 3. Vẽ nét khuất (Dashed line vàng)
    const data = this.planesData[this.activePlane];
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([7, 4]);

    for (const line of data.hidden) {
      ctx.beginPath();
      ctx.moveTo(this.offsetX + line.p1.u * s, this.offsetY - line.p1.v * s);
      ctx.lineTo(this.offsetX + line.p2.u * s, this.offsetY - line.p2.v * s);
      ctx.stroke();
    }

    // 4. Vẽ nét thấy (Solid line trắng sáng 2.6px)
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([]);

    for (const line of data.visible) {
      ctx.beginPath();
      ctx.moveTo(this.offsetX + line.p1.u * s, this.offsetY - line.p1.v * s);
      ctx.lineTo(this.offsetX + line.p2.u * s, this.offsetY - line.p2.v * s);
      ctx.stroke();
    }

    // 5. Điểm chờ vẽ (Điểm 1)
    if (this.pendingPoint) {
      ctx.beginPath();
      ctx.arc(this.pendingPoint.canvasX, this.pendingPoint.canvasY, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#f43f5e';
      ctx.fill();

      if (this.hoverSnap) {
        ctx.beginPath();
        ctx.moveTo(this.pendingPoint.canvasX, this.pendingPoint.canvasY);
        ctx.lineTo(this.hoverSnap.canvasX, this.hoverSnap.canvasY);
        ctx.strokeStyle = (this.tool === 'draw-hidden') ? '#facc15' : '#f43f5e';
        ctx.lineWidth = 2;
        if (this.tool === 'draw-hidden') ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 6. Điểm bắt dính hover (Snap marker)
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
      ctx.textAlign = 'left';
      ctx.fillText(`(${this.hoverSnap.u}, ${this.hoverSnap.v})`, this.hoverSnap.canvasX + 9, this.hoverSnap.canvasY - 9);
    }
  }
}
