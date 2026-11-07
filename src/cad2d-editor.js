import { DXFExporter } from './dxf-exporter.js';

/**
 * CAD2DEditor
 * Không gian vẽ 2D kỹ thuật chuyên nghiệp trên mặt phẳng X-Y
 * - Lưới rộng vô cực với hệ trục X-Y đậm nét
 * - Vẽ nét thẳng thấy/khuất, cung tròn 3 điểm, đường tròn tâm-bán kính
 * - Tỉa xóa nét chi tiết (xóa từng đoạn mắt lưới nhỏ)
 * - Đo kích thước 2D (Dimensions)
 * - Xuất AutoCAD chuẩn DXF
 */
export class CAD2DEditor {
  constructor(canvasElement, projectionEngine) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.projectionEngine = projectionEngine;

    this.isVisible = false;
    this.currentBrush = null;
    this.bounds = { w: 6, h: 4, d: 4 };

    // Danh sách phần tử 2D
    // line: { type: 'line', style: 'visible'|'hidden', p1: {u, v}, p2: {u, v} }
    // arc: { type: 'arc', style: 'visible'|'hidden', cx, cy, r, startAngle, endAngle }
    // circle: { type: 'circle', style: 'visible'|'hidden', cx, cy, r }
    // dim: { type: 'dim', p1: {u, v}, p2: {u, v}, dist: number }
    this.elements = [];

    // Lịch sử Undo / Redo cho 2D
    this.history = [];
    this.historyIndex = -1;

    // Công cụ hiện tại:
    // 'line-visible', 'line-hidden', 'rect', 'arc', 'tangent-arc', 'circle', 'fillet', 'dim', 'dim-radial', 'erase', 'pan'
    this.tool = 'line-visible';

    // Bắt dính nửa ô (0.5 grid step) hoặc Tự do (free)
    this.snapStep = 0.5;
    this.snapMode = 'grid'; // 'grid' | 'free'

    // Bán kính cho bo cung (Fillet) & tạo nhanh
    this.filletRadius = 1.0;
    this.filletFirst = null; // { elem, clickPoint }
    this.tangentStartVec = null; // hướng tiếp tuyến cho tangent-arc

    // Viewport transform (Pan & Zoom)
    this.scale = 52; // pixels per unit
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Trạng thái các bước vẽ đa điểm
    this.pendingPoints = [];
    this.hoverSnap = null;

    this.bindCanvasEvents();
  }

  setFilletRadius(r) {
    this.filletRadius = Math.max(0.1, Number(r));
    const inp = document.getElementById('input-2d-radius');
    if (inp && parseFloat(inp.value) !== this.filletRadius) {
      inp.value = this.filletRadius;
    }
    this.updateHUDHint();
  }

  toggleSnapMode() {
    this.snapMode = (this.snapMode === 'grid') ? 'free' : 'grid';
    this.updateSnapButton();
    this.updateHUDHint();
    this.render();
  }

  updateSnapButton() {
    const lbl = document.getElementById('lbl-snap-mode');
    const btn = document.getElementById('btn-2d-toggle-snap');
    if (lbl) {
      lbl.innerText = (this.snapMode === 'grid') ? 'Bắt Dính: Lưới (0.5)' : 'Bắt Dính: Tự Do (Free)';
    }
    if (btn) {
      if (this.snapMode === 'free') {
        btn.classList.add('active');
        btn.style.borderColor = '#f59e0b';
        btn.style.color = '#fbbf24';
      } else {
        btn.classList.remove('active');
        btn.style.borderColor = '';
        btn.style.color = '';
      }
    }
  }

  saveHistory() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(JSON.parse(JSON.stringify(this.elements)));
    this.historyIndex = this.history.length - 1;
    this.updateUndoButtons();
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.elements = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
      this.pendingPoints = [];
      this.render();
      this.updateUndoButtons();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.elements = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
      this.pendingPoints = [];
      this.render();
      this.updateUndoButtons();
    }
  }

  updateUndoButtons() {
    const btnUndo = document.getElementById('btn-2d-undo');
    const btnRedo = document.getElementById('btn-2d-redo');
    if (btnUndo) btnUndo.disabled = (this.historyIndex <= 0);
    if (btnRedo) btnRedo.disabled = (this.historyIndex >= this.history.length - 1);
  }

  setTool(toolName) {
    this.tool = toolName;
    this.pendingPoints = [];
    if (this.tool === 'pan') {
      this.canvas.style.cursor = 'grab';
    } else if (this.tool === 'toggle-style') {
      this.canvas.style.cursor = 'pointer';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
    this.updateHUDHint();
    this.render();
  }

  show(brush, bounds) {
    this.isVisible = true;
    this.currentBrush = brush;
    this.bounds = bounds;
    this.canvas.parentElement.style.display = 'block';
    this.resize();
    if (this.offsetX === 0 && this.offsetY === 0) {
      this.centerView();
    }
    this.updateHUDHint();
    this.render();
  }

  hide() {
    this.isVisible = false;
    this.canvas.parentElement.style.display = 'none';
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

  centerView() {
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const { w, h } = this.bounds;

    // Tính toán scale tự động để khối bao quanh chiếm 60% chiều cao màn hình
    const targetPixelH = rect.height * 0.55;
    this.scale = Math.max(35, Math.min(85, Math.round(targetPixelH / Math.max(4, h))));

    // Đặt gốc tọa độ O(0,0) lệch sang trái một chút để chừa chỗ cho sidebar
    this.offsetX = Math.round(rect.width * 0.38);
    this.offsetY = Math.round(rect.height * 0.72);
  }

  // Nạp nét hình chiếu đứng từ mô hình 3D
  syncFrom3D() {
    if (!this.currentBrush) return;
    const proj = this.projectionEngine.generateProjections(this.currentBrush, this.bounds);
    const front = proj.front;

    this.elements = [];

    if (front.visible) {
      for (const line of front.visible) {
        this.elements.push({
          type: 'line',
          style: 'visible',
          p1: { u: line.p1.u, v: line.p1.v },
          p2: { u: line.p2.u, v: line.p2.v }
        });
      }
    }
    if (front.hidden) {
      for (const line of front.hidden) {
        this.elements.push({
          type: 'line',
          style: 'hidden',
          p1: { u: line.p1.u, v: line.p1.v },
          p2: { u: line.p2.u, v: line.p2.v }
        });
      }
    }

    this.saveHistory();
    this.render();
  }

  clearPlane() {
    this.elements = [];
    this.pendingPoints = [];
    this.saveHistory();
    this.render();
  }

  // --- TỌA ĐỘ VÀ BẮT DÍNH THÔNG MINH (SMART OSNAP & GRID SNAP) ---
  getSnapPoint(screenX, screenY) {
    const s = this.scale;
    const uRaw = (screenX - this.offsetX) / s;
    const vRaw = -(screenY - this.offsetY) / s; // Y toán học hướng lên

    // 1. Kiểm tra các điểm mốc hình học (Smart OSNAP: Đầu mút, Tâm, Trung điểm, Góc phôi)
    const candidates = [];
    const { w, h } = this.bounds;
    candidates.push(
      { u: 0, v: 0, type: 'corner', label: 'Gốc O(0,0)' },
      { u: w, v: 0, type: 'corner', label: 'Góc phôi' },
      { u: w, v: h, type: 'corner', label: 'Góc phôi' },
      { u: 0, v: h, type: 'corner', label: 'Góc phôi' }
    );

    for (const elem of this.elements) {
      if (elem.type === 'line') {
        candidates.push(
          { u: elem.p1.u, v: elem.p1.v, type: 'endpoint', label: 'Đầu mút' },
          { u: elem.p2.u, v: elem.p2.v, type: 'endpoint', label: 'Đầu mút' },
          { u: (elem.p1.u + elem.p2.u) / 2, v: (elem.p1.v + elem.p2.v) / 2, type: 'midpoint', label: 'Trung điểm' }
        );
      } else if (elem.type === 'circle') {
        candidates.push(
          { u: elem.cx, v: elem.cy, type: 'center', label: 'Tâm tròn' },
          { u: elem.cx + elem.r, v: elem.cy, type: 'quadrant', label: 'Góc 1/4' },
          { u: elem.cx - elem.r, v: elem.cy, type: 'quadrant', label: 'Góc 1/4' },
          { u: elem.cx, v: elem.cy + elem.r, type: 'quadrant', label: 'Góc 1/4' },
          { u: elem.cx, v: elem.cy - elem.r, type: 'quadrant', label: 'Góc 1/4' }
        );
      } else if (elem.type === 'arc') {
        const p1u = elem.cx + elem.r * Math.cos(elem.startAngle);
        const p1v = elem.cy + elem.r * Math.sin(elem.startAngle);
        const p2u = elem.cx + elem.r * Math.cos(elem.endAngle);
        const p2v = elem.cy + elem.r * Math.sin(elem.endAngle);
        let sweep = elem.endAngle - elem.startAngle;
        if (sweep < 0) sweep += Math.PI * 2;
        const midA = elem.startAngle + sweep / 2;
        const pMu = elem.cx + elem.r * Math.cos(midA);
        const pMv = elem.cy + elem.r * Math.sin(midA);

        candidates.push(
          { u: elem.cx, v: elem.cy, type: 'center', label: 'Tâm cung' },
          { u: p1u, v: p1v, type: 'endpoint', label: 'Mút cung' },
          { u: p2u, v: p2v, type: 'endpoint', label: 'Mút cung' },
          { u: pMu, v: pMv, type: 'midpoint', label: 'Điểm giữa cung' }
        );
      }
    }

    let bestCand = null;
    let minPixDist = 14; // Ngưỡng bắt dính hình học (14 pixels)

    for (const cand of candidates) {
      const cX = this.offsetX + cand.u * s;
      const cY = this.offsetY - cand.v * s;
      const dist = Math.hypot(screenX - cX, screenY - cY);
      if (dist < minPixDist) {
        minPixDist = dist;
        bestCand = {
          u: Number(cand.u.toFixed(2)),
          v: Number(cand.v.toFixed(2)),
          canvasX: cX,
          canvasY: cY,
          snapType: cand.type,
          label: cand.label
        };
      }
    }

    if (bestCand) {
      return bestCand;
    }

    // 2. Bắt dính trên đường cong / cung tròn / đoạn thẳng (Nearest OSNAP)
    let bestNearest = null;
    let minNearestPix = 14;

    for (const elem of this.elements) {
      if (elem.type === 'arc') {
        const dCenter = Math.hypot(uRaw - elem.cx, vRaw - elem.cy);
        const angle = this.normAngle(Math.atan2(vRaw - elem.cy, uRaw - elem.cx));
        if (this.isAngleOnArc(angle, elem.startAngle, elem.endAngle)) {
          const uProj = elem.cx + elem.r * Math.cos(angle);
          const vProj = elem.cy + elem.r * Math.sin(angle);
          const cX = this.offsetX + uProj * s;
          const cY = this.offsetY - vProj * s;
          const pixDist = Math.hypot(screenX - cX, screenY - cY);
          if (pixDist < minNearestPix) {
            minNearestPix = pixDist;
            bestNearest = {
              u: Number(uProj.toFixed(2)),
              v: Number(vProj.toFixed(2)),
              canvasX: cX,
              canvasY: cY,
              snapType: 'nearest',
              label: 'Điểm trên cung'
            };
          }
        }
      } else if (elem.type === 'circle') {
        const angle = Math.atan2(vRaw - elem.cy, uRaw - elem.cx);
        const uProj = elem.cx + elem.r * Math.cos(angle);
        const vProj = elem.cy + elem.r * Math.sin(angle);
        const cX = this.offsetX + uProj * s;
        const cY = this.offsetY - vProj * s;
        const pixDist = Math.hypot(screenX - cX, screenY - cY);
        if (pixDist < minNearestPix) {
          minNearestPix = pixDist;
          bestNearest = {
            u: Number(uProj.toFixed(2)),
            v: Number(vProj.toFixed(2)),
            canvasX: cX,
            canvasY: cY,
            snapType: 'nearest',
            label: 'Điểm trên đường tròn'
          };
        }
      } else if (elem.type === 'line') {
        const ab = { u: elem.p2.u - elem.p1.u, v: elem.p2.v - elem.p1.v };
        const ap = { u: uRaw - elem.p1.u, v: vRaw - elem.p1.v };
        const l2 = ab.u * ab.u + ab.v * ab.v;
        if (l2 > 1e-6) {
          const t = Math.max(0, Math.min(1, (ap.u * ab.u + ap.v * ab.v) / l2));
          const uProj = elem.p1.u + t * ab.u;
          const vProj = elem.p1.v + t * ab.v;
          const cX = this.offsetX + uProj * s;
          const cY = this.offsetY - vProj * s;
          const pixDist = Math.hypot(screenX - cX, screenY - cY);
          if (pixDist < minNearestPix) {
            minNearestPix = pixDist;
            bestNearest = {
              u: Number(uProj.toFixed(2)),
              v: Number(vProj.toFixed(2)),
              canvasX: cX,
              canvasY: cY,
              snapType: 'nearest',
              label: 'Điểm trên nét'
            };
          }
        }
      }
    }

    if (bestNearest) {
      return bestNearest;
    }

    // 3. Chế độ Tự Do (Freeform) - không bị ép cố định vào lưới
    const isFree = isAltOrFree || (this.snapMode === 'free');
    if (isFree) {
      return {
        u: Number(uRaw.toFixed(2)),
        v: Number(vRaw.toFixed(2)),
        canvasX: screenX,
        canvasY: screenY,
        snapType: 'free',
        label: 'Tự do'
      };
    }

    // 4. Bắt dính ô lưới bước 0.5 unit (Grid Snap)
    const step = this.snapStep;
    const uSnap = Math.round(uRaw / step) * step;
    const vSnap = Math.round(vRaw / step) * step;

    return {
      u: Number(uSnap.toFixed(2)),
      v: Number(vSnap.toFixed(2)),
      canvasX: this.offsetX + uSnap * s,
      canvasY: this.offsetY - vSnap * s,
      snapType: 'grid',
      label: null
    };
  }

  bindCanvasEvents() {
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Pan view (chuột giữa hoặc chuột phải hoặc phím Shift hoặc công cụ pan)
      if (e.button === 1 || e.button === 2 || this.tool === 'pan' || (e.button === 0 && e.shiftKey)) {
        this.isPanning = true;
        this.panStart = { x: mouseX - this.offsetX, y: mouseY - this.offsetY };
        this.canvas.style.cursor = 'grabbing';
        return;
      }

      if (e.button === 0) {
        const rawU = Number(((mouseX - this.offsetX) / this.scale).toFixed(3));
        const rawV = Number((-(mouseY - this.offsetY) / this.scale).toFixed(3));
        const rawPoint = { u: rawU, v: rawV };
        const snap = this.getSnapPoint(mouseX, mouseY, e.altKey);
        if (!snap) return;

        this.handleToolClick(snap, rawPoint);
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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

      this.hoverSnap = this.getSnapPoint(mouseX, mouseY, e.altKey);
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
      const newScale = Math.max(18, Math.min(160, this.scale * factor));

      this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
      this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;

      this.render();
    }, { passive: false });

    // Phím tắt thao tác 2D
    window.addEventListener('keydown', (e) => {
      if (!this.isVisible) return;
      if (e.target.tagName === 'INPUT') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        this.toggleSnapMode();
      } else if (e.key === 'Escape') {
        this.pendingPoints = [];
        this.filletFirst = null;
        this.tangentStartVec = null;
        this.render();
      }
    });
  }

  handleToolClick(snap, rawPoint) {
    // 1. Vẽ nét thẳng (Thấy hoặc Khuất)
    if (this.tool === 'line-visible' || this.tool === 'line-hidden') {
      if (this.pendingPoints.length === 0) {
        this.pendingPoints.push(snap);
      } else {
        const p1 = this.pendingPoints[0];
        const p2 = snap;

        if (p1.u !== p2.u || p1.v !== p2.v) {
          const style = (this.tool === 'line-hidden') ? 'hidden' : 'visible';
          this.elements.push({
            type: 'line',
            style,
            p1: { u: p1.u, v: p1.v },
            p2: { u: p2.u, v: p2.v }
          });
          this.saveHistory();
        }
        this.pendingPoints = [];
      }
      this.render();
      return;
    }

    // 2. Vẽ hình chữ nhật (Rectangle)
    if (this.tool === 'rect') {
      if (this.pendingPoints.length === 0) {
        this.pendingPoints.push(snap);
      } else {
        const p1 = this.pendingPoints[0];
        const p2 = snap;
        if (Math.abs(p2.u - p1.u) > 0.05 && Math.abs(p2.v - p1.v) > 0.05) {
          const u1 = p1.u, v1 = p1.v;
          const u2 = p2.u, v2 = p2.v;
          this.elements.push(
            { type: 'line', style: 'visible', p1: { u: u1, v: v1 }, p2: { u: u2, v: v1 } },
            { type: 'line', style: 'visible', p1: { u: u2, v: v1 }, p2: { u: u2, v: v2 } },
            { type: 'line', style: 'visible', p1: { u: u2, v: v2 }, p2: { u: u1, v: v2 } },
            { type: 'line', style: 'visible', p1: { u: u1, v: v2 }, p2: { u: u1, v: v1 } }
          );
          this.saveHistory();
        }
        this.pendingPoints = [];
      }
      this.render();
      return;
    }

    // 3. Vẽ cung tròn 3 điểm (3-Point Arc)
    if (this.tool === 'arc') {
      this.pendingPoints.push(snap);
      if (this.pendingPoints.length === 3) {
        const [A, B, C] = this.pendingPoints;
        const circleParams = this.calculateCircleFrom3Points(A, B, C);
        if (circleParams) {
          const arcObj = this.makeCCWArc(circleParams.cx, circleParams.cy, circleParams.r, A, B, C, 'visible');
          this.elements.push(arcObj);
          this.saveHistory();
        }
        this.pendingPoints = [];
      }
      this.render();
      return;
    }

    // 4. Vẽ cung nối tiếp tuyến (Tangent Arc)
    if (this.tool === 'tangent-arc') {
      if (this.pendingPoints.length === 0) {
        let bestDist = 0.6;
        let startPoint = snap;
        let tangentVec = null;

        for (const elem of this.elements) {
          if (elem.type === 'line') {
            const d1 = Math.hypot(snap.u - elem.p1.u, snap.v - elem.p1.v);
            const d2 = Math.hypot(snap.u - elem.p2.u, snap.v - elem.p2.v);
            if (d1 < bestDist) {
              bestDist = d1;
              startPoint = { u: elem.p1.u, v: elem.p1.v };
              const L = Math.hypot(elem.p1.u - elem.p2.u, elem.p1.v - elem.p2.v);
              tangentVec = { u: (elem.p1.u - elem.p2.u) / L, v: (elem.p1.v - elem.p2.v) / L };
            } else if (d2 < bestDist) {
              bestDist = d2;
              startPoint = { u: elem.p2.u, v: elem.p2.v };
              const L = Math.hypot(elem.p2.u - elem.p1.u, elem.p2.v - elem.p1.v);
              tangentVec = { u: (elem.p2.u - elem.p1.u) / L, v: (elem.p2.v - elem.p1.v) / L };
            }
          } else if (elem.type === 'arc') {
            const p1 = { u: elem.cx + elem.r * Math.cos(elem.startAngle), v: elem.cy + elem.r * Math.sin(elem.startAngle) };
            const p2 = { u: elem.cx + elem.r * Math.cos(elem.endAngle), v: elem.cy + elem.r * Math.sin(elem.endAngle) };
            const d1 = Math.hypot(snap.u - p1.u, snap.v - p1.v);
            const d2 = Math.hypot(snap.u - p2.u, snap.v - p2.v);
            if (d1 < bestDist) {
              bestDist = d1;
              startPoint = p1;
              tangentVec = { u: Math.sin(elem.startAngle), v: -Math.cos(elem.startAngle) };
            } else if (d2 < bestDist) {
              bestDist = d2;
              startPoint = p2;
              tangentVec = { u: -Math.sin(elem.endAngle), v: Math.cos(elem.endAngle) };
            }
          }
        }

        if (!tangentVec) {
          tangentVec = { u: 1, v: 0 };
        }

        this.pendingPoints = [startPoint];
        this.tangentStartVec = tangentVec;
      } else {
        const P0 = this.pendingPoints[0];
        const P1 = snap;
        const T0 = this.tangentStartVec;

        const dx = P1.u - P0.u;
        const dy = P1.v - P0.v;
        const dist2 = dx * dx + dy * dy;
        const N0 = { u: -T0.v, v: T0.u };
        const dot = dx * N0.u + dy * N0.v;

        if (Math.abs(dot) > 1e-4 && dist2 > 0.05) {
          const R = dist2 / (2 * dot);
          const cx = P0.u + R * N0.u;
          const cy = P0.v + R * N0.v;
          const r = Math.abs(R);

          const arcObj = this.makeCCWArc(cx, cy, r, P0, P1, 'visible');
          this.elements.push(arcObj);
          this.saveHistory();
        }
        this.pendingPoints = [];
        this.tangentStartVec = null;
      }
      this.render();
      return;
    }

    // 5. Vẽ đường tròn qua Tâm và Bán kính (Center + Radius)
    if (this.tool === 'circle') {
      if (this.pendingPoints.length === 0) {
        this.pendingPoints.push(snap);
      } else {
        const center = this.pendingPoints[0];
        const r = Math.hypot(snap.u - center.u, snap.v - center.v);
        if (r > 0.1) {
          this.elements.push({
            type: 'circle',
            style: 'visible',
            cx: center.u,
            cy: center.v,
            r: Number(r.toFixed(2))
          });
          this.saveHistory();
        }
        this.pendingPoints = [];
      }
      this.render();
      return;
    }

    // 6. Bo cung tiếp tuyến (FILLET)
    if (this.tool === 'fillet') {
      const clickPoint = rawPoint || snap;
      const target = this.findNearestEntity(clickPoint);

      if (!target) {
        return;
      }

      if (!this.filletFirst) {
        this.filletFirst = { elem: target.elem, clickPoint };
        this.updateHUDHint();
        this.render();
        return;
      }

      const elemA = this.filletFirst.elem;
      const ptA = this.filletFirst.clickPoint;
      const elemB = target.elem;
      const ptB = clickPoint;

      if (elemA === elemB) {
        this.filletFirst = null;
        this.updateHUDHint();
        this.render();
        return;
      }

      const R = this.filletRadius;
      const success = this.applyFillet(elemA, ptA, elemB, ptB, R);
      this.filletFirst = null;
      if (success) {
        this.saveHistory();
      }
      this.updateHUDHint();
      this.render();
      return;
    }

    // 7. Đo kích thước 2D (DIM: Tuyến tính & DIM-RADIAL: Bán kính R / Đường kính Ø)
    if (this.tool === 'dim' || this.tool === 'dim-radial') {
      const clickPoint = rawPoint || snap;

      // Kiểm tra nếu click vào Cung Tròn hoặc Đường Tròn
      let targetCurve = null;
      let minCurveDist = Math.max(0.4, 20 / this.scale);

      for (const elem of this.elements) {
        if (elem.type === 'arc') {
          const dCenter = Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy);
          const angle = this.normAngle(Math.atan2(clickPoint.v - elem.cy, clickPoint.u - elem.cx));
          if (this.isAngleOnArc(angle, elem.startAngle, elem.endAngle)) {
            const dist = Math.abs(dCenter - elem.r);
            if (dist < minCurveDist) {
              minCurveDist = dist;
              targetCurve = { elem, angle };
            }
          }
        } else if (elem.type === 'circle') {
          const dCenter = Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy);
          const dist = Math.abs(dCenter - elem.r);
          if (dist < minCurveDist) {
            const angle = this.normAngle(Math.atan2(clickPoint.v - elem.cy, clickPoint.u - elem.cx));
            minCurveDist = dist;
            targetCurve = { elem, angle };
          }
        }
      }

      if (this.tool === 'dim-radial' || (this.tool === 'dim' && this.pendingPoints.length === 0 && targetCurve)) {
        if (targetCurve) {
          const { elem, angle } = targetCurve;
          const isCircle = (elem.type === 'circle');
          this.elements.push({
            type: 'dim-radial',
            targetType: elem.type,
            cx: elem.cx,
            cy: elem.cy,
            r: elem.r,
            angle: Number(angle.toFixed(3)),
            isDiameter: isCircle,
            dist: isCircle ? Number((elem.r * 2).toFixed(2)) : Number(elem.r.toFixed(2))
          });
          this.pendingPoints = [];
          this.saveHistory();
          this.render();
          return;
        }
      }

      // Đo kích thước thẳng giữa 2 điểm (Linear Dimension)
      if (this.pendingPoints.length === 0) {
        this.pendingPoints.push(snap);
      } else {
        const p1 = this.pendingPoints[0];
        const p2 = snap;
        const dist = Math.hypot(p2.u - p1.u, p2.v - p1.v);
        if (dist > 0.05) {
          this.elements.push({
            type: 'dim',
            p1, p2,
            dist: Number(dist.toFixed(2))
          });
          this.saveHistory();
        }
        this.pendingPoints = [];
      }
      this.render();
      return;
    }

    // 5. TỈA NÉT CẮT AUTOCAD (TRIM TOOL)
    if (this.tool === 'erase') {
      this.trimAtPoint(rawPoint || snap);
      return;
    }

    // 6. ĐỔI NHANH NÉT THẤY / NÉT KHUẤT
    if (this.tool === 'toggle-style') {
      const clickPoint = rawPoint || snap;
      let bestElem = null;
      let bestDist = Infinity;

      for (let i = 0; i < this.elements.length; i++) {
        const elem = this.elements[i];
        let d = Infinity;
        if (elem.type === 'line') {
          d = this.pointToSegmentDistance(clickPoint, elem.p1, elem.p2);
        } else if (elem.type === 'circle') {
          d = Math.abs(Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy) - elem.r);
        } else if (elem.type === 'arc') {
          const distC = Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy);
          const angle = this.normAngle(Math.atan2(clickPoint.v - elem.cy, clickPoint.u - elem.cx));
          if (this.isAngleOnArc(angle, elem.startAngle, elem.endAngle)) {
            d = Math.abs(distC - elem.r);
          }
        }

        if (d < bestDist) {
          bestDist = d;
          bestElem = elem;
        }
      }

      const threshold = Math.max(0.4, 20 / this.scale);
      if (bestElem && bestDist <= threshold && bestElem.type !== 'dim') {
        bestElem.style = (bestElem.style === 'hidden') ? 'visible' : 'hidden';
        this.saveHistory();
        this.render();
      }
      return;
    }
  }

  // --- HỆ THỐNG TỈA NÉT CẮT AUTOCAD CHUẨN XÁC (TRIM ENGINE) ---
  normAngle(a) {
    let res = a % (Math.PI * 2);
    if (res < 0) res += Math.PI * 2;
    return res;
  }

  isAngleOnArc(angle, startAngle, endAngle) {
    const normA = this.normAngle(angle);
    const normS = this.normAngle(startAngle);
    const normE = this.normAngle(endAngle);

    let sweep = normE - normS;
    if (sweep < 0) sweep += Math.PI * 2;
    if (sweep < 1e-5) sweep = Math.PI * 2;

    let delta = normA - normS;
    if (delta < 0) delta += Math.PI * 2;

    return delta >= -1e-4 && delta <= sweep + 1e-4;
  }

  intersectSegmentSegment(p1, p2, p3, p4) {
    const d1x = p2.u - p1.u, d1y = p2.v - p1.v;
    const d2x = p4.u - p3.u, d2y = p4.v - p3.v;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-7) return null;

    const dx = p3.u - p1.u;
    const dy = p3.v - p1.v;
    const t = (dx * d2y - dy * d2x) / cross;
    const s = (dx * d1y - dy * d1x) / cross;

    if (t > 1e-4 && t < 1 - 1e-4 && s > 1e-4 && s < 1 - 1e-4) {
      return {
        u: p1.u + t * d1x,
        v: p1.v + t * d1y,
        tA: t,
        tB: s
      };
    }
    return null;
  }

  intersectSegmentCircle(p1, p2, circle) {
    const dx = p2.u - p1.u;
    const dy = p2.v - p1.v;
    const fx = p1.u - circle.cx;
    const fy = p1.v - circle.cy;

    const a = dx * dx + dy * dy;
    if (a < 1e-8) return [];

    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - circle.r * circle.r;
    const discr = b * b - 4 * a * c;

    if (discr < 1e-7) return [];

    const sqrtD = Math.sqrt(Math.max(0, discr));
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);

    const pts = [];
    for (const t of [t1, t2]) {
      if (t > 1e-4 && t < 1 - 1e-4) {
        const u = p1.u + t * dx;
        const v = p1.v + t * dy;
        const angle = this.normAngle(Math.atan2(v - circle.cy, u - circle.cx));
        pts.push({ u, v, t, angle });
      }
    }
    return pts;
  }

  intersectSegmentArc(p1, p2, arc) {
    const raw = this.intersectSegmentCircle(p1, p2, { cx: arc.cx, cy: arc.cy, r: arc.r });
    return raw.filter(pt => this.isAngleOnArc(pt.angle, arc.startAngle, arc.endAngle));
  }

  intersectCircleCircle(c1, c2) {
    const dx = c2.cx - c1.cx;
    const dy = c2.cy - c1.cy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-7 || d > c1.r + c2.r - 1e-5 || d < Math.abs(c1.r - c2.r) + 1e-5) {
      return [];
    }

    const a = (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d);
    const h2 = c1.r * c1.r - a * a;
    if (h2 < 0) return [];
    const h = Math.sqrt(Math.max(0, h2));

    const x2 = c1.cx + (dx * a) / d;
    const y2 = c1.cy + (dy * a) / d;

    const rx = -dy * (h / d);
    const ry = dx * (h / d);

    const pt1 = { u: x2 + rx, v: y2 + ry };
    const pt2 = { u: x2 - rx, v: y2 - ry };

    const res = [];
    for (const pt of [pt1, pt2]) {
      const angle1 = this.normAngle(Math.atan2(pt.v - c1.cy, pt.u - c1.cx));
      const angle2 = this.normAngle(Math.atan2(pt.v - c2.cy, pt.u - c2.cx));
      res.push({ u: pt.u, v: pt.v, angle1, angle2 });
    }
    return res;
  }

  intersectCircleArc(circle, arc) {
    const raw = this.intersectCircleCircle(circle, { cx: arc.cx, cy: arc.cy, r: arc.r });
    return raw
      .filter(pt => this.isAngleOnArc(pt.angle2, arc.startAngle, arc.endAngle))
      .map(pt => ({
        u: pt.u,
        v: pt.v,
        angleCircle: pt.angle1,
        angleArc: pt.angle2
      }));
  }

  intersectArcArc(arc1, arc2) {
    const raw = this.intersectCircleCircle(
      { cx: arc1.cx, cy: arc1.cy, r: arc1.r },
      { cx: arc2.cx, cy: arc2.cy, r: arc2.r }
    );
    return raw.filter(pt =>
      this.isAngleOnArc(pt.angle1, arc1.startAngle, arc1.endAngle) &&
      this.isAngleOnArc(pt.angle2, arc2.startAngle, arc2.endAngle)
    );
  }

  // TỈA ĐOẠN NÉT BỊ CẮT HOẶC XÓA NÉT (AUTOCAD TRIM)
  trimAtPoint(clickPoint) {
    let bestElem = null;
    let bestDist = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < this.elements.length; i++) {
      const elem = this.elements[i];
      let d = Infinity;
      if (elem.type === 'line') {
        d = this.pointToSegmentDistance(clickPoint, elem.p1, elem.p2);
      } else if (elem.type === 'circle') {
        d = Math.abs(Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy) - elem.r);
      } else if (elem.type === 'arc') {
        const distC = Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy);
        const angle = this.normAngle(Math.atan2(clickPoint.v - elem.cy, clickPoint.u - elem.cx));
        if (this.isAngleOnArc(angle, elem.startAngle, elem.endAngle)) {
          d = Math.abs(distC - elem.r);
        } else {
          const p1 = { u: elem.cx + elem.r * Math.cos(elem.startAngle), v: elem.cy + elem.r * Math.sin(elem.startAngle) };
          const p2 = { u: elem.cx + elem.r * Math.cos(elem.endAngle), v: elem.cy + elem.r * Math.sin(elem.endAngle) };
          d = Math.min(Math.hypot(clickPoint.u - p1.u, clickPoint.v - p1.v), Math.hypot(clickPoint.u - p2.u, clickPoint.v - p2.v));
        }
      } else if (elem.type === 'dim') {
        d = this.pointToSegmentDistance(clickPoint, elem.p1, elem.p2);
      }

      if (d < bestDist) {
        bestDist = d;
        bestElem = elem;
        bestIndex = i;
      }
    }

    const clickThreshold = Math.max(0.45, 24 / this.scale);
    if (!bestElem || bestDist > clickThreshold) return;

    if (bestElem.type === 'dim') {
      this.elements.splice(bestIndex, 1);
      this.saveHistory();
      this.render();
      return;
    }

    const otherElements = this.elements.filter((_, idx) => idx !== bestIndex);

    // 1. TỈA ĐOẠN THẲNG (LINE)
    if (bestElem.type === 'line') {
      let tList = [0, 1];
      for (const other of otherElements) {
        if (other.type === 'line') {
          const inter = this.intersectSegmentSegment(bestElem.p1, bestElem.p2, other.p1, other.p2);
          if (inter) tList.push(inter.tA);
        } else if (other.type === 'circle') {
          const inters = this.intersectSegmentCircle(bestElem.p1, bestElem.p2, other);
          for (const p of inters) tList.push(p.t);
        } else if (other.type === 'arc') {
          const inters = this.intersectSegmentArc(bestElem.p1, bestElem.p2, other);
          for (const p of inters) tList.push(p.t);
        }
      }

      tList.sort((a, b) => a - b);
      const cleanT = [tList[0]];
      for (let i = 1; i < tList.length; i++) {
        if (tList[i] - cleanT[cleanT.length - 1] > 1e-3) {
          cleanT.push(tList[i]);
        }
      }

      if (cleanT.length <= 2) {
        this.elements.splice(bestIndex, 1);
        this.saveHistory();
        this.render();
        return;
      }

      const dx = bestElem.p2.u - bestElem.p1.u;
      const dy = bestElem.p2.v - bestElem.p1.v;
      const len2 = dx * dx + dy * dy;
      let tClick = 0.5;
      if (len2 > 1e-6) {
        tClick = ((clickPoint.u - bestElem.p1.u) * dx + (clickPoint.v - bestElem.p1.v) * dy) / len2;
      }
      tClick = Math.max(0, Math.min(1, tClick));

      let clickedSegIndex = -1;
      for (let k = 0; k < cleanT.length - 1; k++) {
        if (tClick >= cleanT[k] - 1e-4 && tClick <= cleanT[k + 1] + 1e-4) {
          clickedSegIndex = k;
          break;
        }
      }
      if (clickedSegIndex === -1) clickedSegIndex = 0;

      const remaining = [];
      for (let k = 0; k < cleanT.length - 1; k++) {
        if (k !== clickedSegIndex && cleanT[k + 1] - cleanT[k] > 1e-3) {
          const u1 = bestElem.p1.u + cleanT[k] * dx;
          const v1 = bestElem.p1.v + cleanT[k] * dy;
          const u2 = bestElem.p1.u + cleanT[k + 1] * dx;
          const v2 = bestElem.p1.v + cleanT[k + 1] * dy;
          remaining.push({
            type: 'line',
            style: bestElem.style,
            p1: { u: Number(u1.toFixed(3)), v: Number(v1.toFixed(3)) },
            p2: { u: Number(u2.toFixed(3)), v: Number(v2.toFixed(3)) }
          });
        }
      }

      this.elements.splice(bestIndex, 1, ...remaining);
      this.saveHistory();
      this.render();
      return;
    }

    // 2. TỈA ĐƯỜNG TRÒN (CIRCLE -> ARCS)
    if (bestElem.type === 'circle') {
      let angleList = [];
      for (const other of otherElements) {
        if (other.type === 'line') {
          const inters = this.intersectSegmentCircle(other.p1, other.p2, bestElem);
          for (const p of inters) angleList.push(p.angle);
        } else if (other.type === 'circle') {
          const inters = this.intersectCircleCircle(bestElem, other);
          for (const p of inters) angleList.push(p.angle1);
        } else if (other.type === 'arc') {
          const inters = this.intersectCircleArc(bestElem, other);
          for (const p of inters) angleList.push(p.angleCircle);
        }
      }

      angleList.sort((a, b) => a - b);
      const cleanAngles = [];
      for (const a of angleList) {
        if (cleanAngles.length === 0 || a - cleanAngles[cleanAngles.length - 1] > 1e-3) {
          cleanAngles.push(a);
        }
      }
      if (cleanAngles.length >= 2 && (cleanAngles[0] + Math.PI * 2 - cleanAngles[cleanAngles.length - 1]) < 1e-3) {
        cleanAngles.pop();
      }

      if (cleanAngles.length < 2) {
        this.elements.splice(bestIndex, 1);
        this.saveHistory();
        this.render();
        return;
      }

      const kCount = cleanAngles.length;
      const clickAngle = this.normAngle(Math.atan2(clickPoint.v - bestElem.cy, clickPoint.u - bestElem.cx));

      let clickedArcIdx = kCount - 1;
      for (let j = 0; j < kCount - 1; j++) {
        if (clickAngle >= cleanAngles[j] - 1e-4 && clickAngle <= cleanAngles[j + 1] + 1e-4) {
          clickedArcIdx = j;
          break;
        }
      }

      const newArcs = [];
      for (let j = 0; j < kCount; j++) {
        if (j !== clickedArcIdx) {
          const sAngle = cleanAngles[j];
          const eAngle = (j === kCount - 1) ? cleanAngles[0] : cleanAngles[j + 1];
          newArcs.push({
            type: 'arc',
            style: bestElem.style,
            cx: bestElem.cx,
            cy: bestElem.cy,
            r: bestElem.r,
            startAngle: sAngle,
            endAngle: eAngle
          });
        }
      }

      this.elements.splice(bestIndex, 1, ...newArcs);
      this.saveHistory();
      this.render();
      return;
    }

    // 3. TỈA CUNG CONG (ARC -> SUB-ARCS)
    if (bestElem.type === 'arc') {
      let angleList = [];
      for (const other of otherElements) {
        if (other.type === 'line') {
          const inters = this.intersectSegmentArc(other.p1, other.p2, bestElem);
          for (const p of inters) angleList.push(p.angle);
        } else if (other.type === 'circle') {
          const inters = this.intersectCircleArc(other, bestElem);
          for (const p of inters) angleList.push(p.angleArc);
        } else if (other.type === 'arc') {
          const inters = this.intersectArcArc(bestElem, other);
          for (const p of inters) angleList.push(p.angle1);
        }
      }

      let arcSweep = this.normAngle(bestElem.endAngle - bestElem.startAngle);
      if (arcSweep < 1e-5) arcSweep = Math.PI * 2;

      let deltaList = [0, arcSweep];
      for (const a of angleList) {
        const d = this.normAngle(a - bestElem.startAngle);
        if (d > 1e-3 && d < arcSweep - 1e-3) {
          deltaList.push(d);
        }
      }

      deltaList.sort((a, b) => a - b);
      const cleanDeltas = [deltaList[0]];
      for (let i = 1; i < deltaList.length; i++) {
        if (deltaList[i] - cleanDeltas[cleanDeltas.length - 1] > 1e-3) {
          cleanDeltas.push(deltaList[i]);
        }
      }

      if (cleanDeltas.length <= 2) {
        this.elements.splice(bestIndex, 1);
        this.saveHistory();
        this.render();
        return;
      }

      const clickAngle = this.normAngle(Math.atan2(clickPoint.v - bestElem.cy, clickPoint.u - bestElem.cx));
      let clickDelta = this.normAngle(clickAngle - bestElem.startAngle);
      clickDelta = Math.max(0, Math.min(arcSweep, clickDelta));

      let clickedSubIdx = -1;
      for (let k = 0; k < cleanDeltas.length - 1; k++) {
        if (clickDelta >= cleanDeltas[k] - 1e-4 && clickDelta <= cleanDeltas[k + 1] + 1e-4) {
          clickedSubIdx = k;
          break;
        }
      }
      if (clickedSubIdx === -1) clickedSubIdx = 0;

      const newSubArcs = [];
      for (let k = 0; k < cleanDeltas.length - 1; k++) {
        if (k !== clickedSubIdx && cleanDeltas[k + 1] - cleanDeltas[k] > 1e-3) {
          const sAngle = this.normAngle(bestElem.startAngle + cleanDeltas[k]);
          const eAngle = this.normAngle(bestElem.startAngle + cleanDeltas[k + 1]);
          newSubArcs.push({
            type: 'arc',
            style: bestElem.style,
            cx: bestElem.cx,
            cy: bestElem.cy,
            r: bestElem.r,
            startAngle: sAngle,
            endAngle: eAngle
          });
        }
      }

      this.elements.splice(bestIndex, 1, ...newSubArcs);
      this.saveHistory();
      this.render();
      return;
    }
  }

  makeCCWArc(cx, cy, r, A, B, C, style = 'visible') {
    let aA = this.normAngle(Math.atan2(A.v - cy, A.u - cx));
    let aB = this.normAngle(Math.atan2(B.v - cy, B.u - cx));
    let aC = this.normAngle(Math.atan2(C.v - cy, C.u - cx));

    let sweepB = this.normAngle(aB - aA);
    let sweepC = this.normAngle(aC - aA);

    if (sweepB < sweepC) {
      return {
        type: 'arc',
        style,
        cx: Number(cx.toFixed(3)),
        cy: Number(cy.toFixed(3)),
        r: Number(r.toFixed(3)),
        startAngle: aA,
        endAngle: aC
      };
    } else {
      return {
        type: 'arc',
        style,
        cx: Number(cx.toFixed(3)),
        cy: Number(cy.toFixed(3)),
        r: Number(r.toFixed(3)),
        startAngle: aC,
        endAngle: aA
      };
    }
  }

  pointToSegmentDistance(p, a, b) {
    const ab = { u: b.u - a.u, v: b.v - a.v };
    const ap = { u: p.u - a.u, v: p.v - a.v };
    const l2 = ab.u * ab.u + ab.v * ab.v;
    if (l2 < 1e-6) return Math.hypot(p.u - a.u, p.v - a.v);
    let t = Math.max(0, Math.min(1, (ap.u * ab.u + ap.v * ab.v) / l2));
    const proj = { u: a.u + t * ab.u, v: a.v + t * ab.v };
    return Math.hypot(p.u - proj.u, p.v - proj.v);
  }

  calculateCircleFrom3Points(A, B, C) {
    const d = 2 * (A.u * (B.v - C.v) + B.u * (C.v - A.v) + C.u * (A.v - B.v));
    if (Math.abs(d) < 1e-5) return null; // 3 điểm thẳng hàng

    const uA2 = A.u * A.u + A.v * A.v;
    const uB2 = B.u * B.u + B.v * B.v;
    const uC2 = C.u * C.u + C.v * C.v;

    const cx = (uA2 * (B.v - C.v) + uB2 * (C.v - A.v) + uC2 * (A.v - B.v)) / d;
    const cy = (uA2 * (C.u - B.u) + uB2 * (A.u - C.u) + uC2 * (B.u - A.u)) / d;
    const r = Math.hypot(A.u - cx, A.v - cy);
    return { cx, cy, r };
  }

  findNearestEntity(clickPoint) {
    let bestElem = null;
    let bestDist = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < this.elements.length; i++) {
      const elem = this.elements[i];
      let d = Infinity;
      if (elem.type === 'line') {
        d = this.pointToSegmentDistance(clickPoint, elem.p1, elem.p2);
      } else if (elem.type === 'circle') {
        d = Math.abs(Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy) - elem.r);
      } else if (elem.type === 'arc') {
        const distC = Math.hypot(clickPoint.u - elem.cx, clickPoint.v - elem.cy);
        const angle = this.normAngle(Math.atan2(clickPoint.v - elem.cy, clickPoint.u - elem.cx));
        if (this.isAngleOnArc(angle, elem.startAngle, elem.endAngle)) {
          d = Math.abs(distC - elem.r);
        } else {
          const p1 = { u: elem.cx + elem.r * Math.cos(elem.startAngle), v: elem.cy + elem.r * Math.sin(elem.startAngle) };
          const p2 = { u: elem.cx + elem.r * Math.cos(elem.endAngle), v: elem.cy + elem.r * Math.sin(elem.endAngle) };
          d = Math.min(Math.hypot(clickPoint.u - p1.u, clickPoint.v - p1.v), Math.hypot(clickPoint.u - p2.u, clickPoint.v - p2.v));
        }
      }
      if (d < bestDist) {
        bestDist = d;
        bestElem = elem;
        bestIndex = i;
      }
    }

    const clickThreshold = Math.max(0.6, 28 / this.scale);
    if (!bestElem || bestDist > clickThreshold) return null;
    return { elem: bestElem, index: bestIndex, dist: bestDist };
  }

  applyFillet(elemA, ptA, elemB, ptB, R) {
    if (R <= 0.05) return false;

    const projectPointOnLine = (P, p1, p2) => {
      const dx = p2.u - p1.u, dy = p2.v - p1.v;
      const l2 = dx * dx + dy * dy;
      if (l2 < 1e-6) return { ...p1 };
      const t = ((P.u - p1.u) * dx + (P.v - p1.v) * dy) / l2;
      return { u: p1.u + t * dx, v: p1.v + t * dy };
    };

    // CASE 1: Line and Line
    if (elemA.type === 'line' && elemB.type === 'line') {
      const dAx = elemA.p2.u - elemA.p1.u, dAy = elemA.p2.v - elemA.p1.v;
      const dBx = elemB.p2.u - elemB.p1.u, dBy = elemB.p2.v - elemB.p1.v;
      const cross = dAx * dBy - dAy * dBx;
      if (Math.abs(cross) < 1e-5) return false;

      const dx = elemB.p1.u - elemA.p1.u;
      const dy = elemB.p1.v - elemA.p1.v;
      const t = (dx * dBy - dy * dBx) / cross;
      const V = { u: elemA.p1.u + t * dAx, v: elemA.p1.v + t * dAy };

      let vAx = ptA.u - V.u, vAy = ptA.v - V.v;
      let lenA = Math.hypot(vAx, vAy);
      if (lenA < 1e-4) { vAx = dAx; vAy = dAy; lenA = Math.hypot(vAx, vAy); }
      vAx /= lenA; vAy /= lenA;

      let vBx = ptB.u - V.u, vBy = ptB.v - V.v;
      let lenB = Math.hypot(vBx, vBy);
      if (lenB < 1e-4) { vBx = dBx; vBy = dBy; lenB = Math.hypot(vBx, vBy); }
      vBx /= lenB; vBy /= lenB;

      const dot = Math.max(-0.999, Math.min(0.999, vAx * vBx + vAy * vBy));
      const theta = Math.acos(dot);
      if (theta < 0.05 || theta > Math.PI - 0.05) return false;

      const dT = R / Math.tan(theta / 2);
      const dC = R / Math.sin(theta / 2);

      let bX = vAx + vBx, bY = vAy + vBy;
      const bLen = Math.hypot(bX, bY);
      if (bLen < 1e-4) return false;
      bX /= bLen; bY /= bLen;

      const Cf = { u: V.u + dC * bX, v: V.v + dC * bY };
      const TA = { u: V.u + dT * vAx, v: V.v + dT * vAy };
      const TB = { u: V.u + dT * vBx, v: V.v + dT * vBy };

      const arcObj = this.makeCCWArc(Cf.u, Cf.v, R, TA, TB, 'visible');
      this.elements.push(arcObj);

      const distA1 = Math.hypot(elemA.p1.u - V.u, elemA.p1.v - V.v);
      const distA2 = Math.hypot(elemA.p2.u - V.u, elemA.p2.v - V.v);
      if (distA1 < distA2) elemA.p1 = TA; else elemA.p2 = TA;

      const distB1 = Math.hypot(elemB.p1.u - V.u, elemB.p1.v - V.v);
      const distB2 = Math.hypot(elemB.p2.u - V.u, elemB.p2.v - V.v);
      if (distB1 < distB2) elemB.p1 = TB; else elemB.p2 = TB;

      return true;
    }

    // CASE 2: Line and Arc/Circle
    let lineElem = (elemA.type === 'line') ? elemA : (elemB.type === 'line' ? elemB : null);
    let curveElem = (lineElem === elemA) ? elemB : elemA;
    let ptLine = (lineElem === elemA) ? ptA : ptB;
    let ptCurve = (lineElem === elemA) ? ptB : ptA;

    if (lineElem && (curveElem.type === 'circle' || curveElem.type === 'arc')) {
      const p1 = lineElem.p1, p2 = lineElem.p2;
      const ldx = p2.u - p1.u, ldy = p2.v - p1.v;
      const lLen = Math.hypot(ldx, ldy);
      if (lLen < 1e-4) return false;
      const uX = ldx / lLen, uY = ldy / lLen;
      const nX = -uY, nY = uX;

      const side = ((ptLine.u - p1.u) * nX + (ptLine.v - p1.v) * nY) >= 0 ? 1 : -1;
      const offP1 = { u: p1.u + side * R * nX, v: p1.v + side * R * nY };

      const Rc = curveElem.r;
      const dCenterClick = Math.hypot(ptCurve.u - curveElem.cx, ptCurve.v - curveElem.cy);
      const Roff = (dCenterClick > Rc) ? (Rc + R) : Math.abs(Rc - R);

      const proj = projectPointOnLine({ u: curveElem.cx, v: curveElem.cy }, offP1, { u: offP1.u + uX, v: offP1.v + uY });
      const hDist = Math.hypot(curveElem.cx - proj.u, curveElem.cy - proj.v);
      if (hDist > Roff) return false;

      const dChord = Math.sqrt(Math.max(0, Roff * Roff - hDist * hDist));
      const C1 = { u: proj.u + dChord * uX, v: proj.v + dChord * uY };
      const C2 = { u: proj.u - dChord * uX, v: proj.v - dChord * uY };

      const midClick = { u: (ptLine.u + ptCurve.u) / 2, v: (ptLine.v + ptCurve.v) / 2 };
      const distC1 = Math.hypot(C1.u - midClick.u, C1.v - midClick.v);
      const distC2 = Math.hypot(C2.u - midClick.u, C2.v - midClick.v);
      const Cf = (distC1 < distC2) ? C1 : C2;

      const TLine = projectPointOnLine(Cf, p1, p2);
      const dToC = Math.hypot(Cf.u - curveElem.cx, Cf.v - curveElem.cy);
      const TCurve = {
        u: curveElem.cx + Rc * (Cf.u - curveElem.cx) / dToC,
        v: curveElem.cy + Rc * (Cf.v - curveElem.cy) / dToC
      };

      const arcObj = this.makeCCWArc(Cf.u, Cf.v, R, TLine, TCurve, 'visible');
      this.elements.push(arcObj);

      const dP1 = Math.hypot(p1.u - TLine.u, p1.v - TLine.v);
      const dP2 = Math.hypot(p2.u - TLine.u, p2.v - TLine.v);
      if (dP1 < dP2) lineElem.p1 = TLine; else lineElem.p2 = TLine;

      return true;
    }

    // CASE 3: Arc/Circle and Arc/Circle
    if ((elemA.type === 'circle' || elemA.type === 'arc') && (elemB.type === 'circle' || elemB.type === 'arc')) {
      const R1 = elemA.r, R2 = elemB.r;
      const R1o = R1 + R;
      const R2o = R2 + R;

      const inters = this.intersectCircleCircle(
        { cx: elemA.cx, cy: elemA.cy, r: R1o },
        { cx: elemB.cx, cy: elemB.cy, r: R2o }
      );
      if (!inters || inters.length === 0) return false;

      const midClick = { u: (ptA.u + ptB.u) / 2, v: (ptA.v + ptB.v) / 2 };
      let bestCenter = null;
      let minD = Infinity;
      for (const p of inters) {
        const d = Math.hypot(p.u - midClick.u, p.v - midClick.v);
        if (d < minD) { minD = d; bestCenter = p; }
      }
      if (!bestCenter) return false;

      const Cf = bestCenter;
      const d1 = Math.hypot(Cf.u - elemA.cx, Cf.v - elemA.cy);
      const d2 = Math.hypot(Cf.u - elemB.cx, Cf.v - elemB.cy);

      const TA = { u: elemA.cx + R1 * (Cf.u - elemA.cx) / d1, v: elemA.cy + R1 * (Cf.v - elemA.cy) / d1 };
      const TB = { u: elemB.cx + R2 * (Cf.u - elemB.cx) / d2, v: elemB.cy + R2 * (Cf.v - elemB.cy) / d2 };

      const arcObj = this.makeCCWArc(Cf.u, Cf.v, R, TA, TB, 'visible');
      this.elements.push(arcObj);
      return true;
    }

    return false;
  }

  updateHUDHint() {
    const hintEl = document.querySelector('.cad2d-hint');
    if (!hintEl) return;

    const snapModeText = (this.snapMode === 'free') 
      ? '<span style="color:#fbbf24; font-weight:bold;">Tự Do (Free)</span>' 
      : '<span style="color:#38bdf8; font-weight:bold;">Lưới (0.5)</span>';
    let toolHint = '';

    if (this.tool === 'line-visible') {
      toolHint = `✏️ <b>Vẽ Nét Thấy:</b> Click Điểm 1 ➔ Click Điểm 2 để nối nét liền đậm`;
    } else if (this.tool === 'line-hidden') {
      toolHint = `✏️ <b>Vẽ Nét Khuất:</b> Click 2 điểm để vẽ nét đứt vàng`;
    } else if (this.tool === 'rect') {
      toolHint = `🔲 <b>Hình Chữ Nhật:</b> Click Góc 1 ➔ Click Góc đối diện để tạo khung nhanh`;
    } else if (this.tool === 'arc') {
      const step = this.pendingPoints.length + 1;
      toolHint = `⌒ <b>Vẽ Cung Cong (3 Điểm):</b> Đang chờ Click <b>Điểm ${step}/3</b>`;
    } else if (this.tool === 'tangent-arc') {
      toolHint = (this.pendingPoints.length === 0)
        ? `⌒ <b>Cung Tiếp Tuyến:</b> Click chọn đầu mút nét để bắt đầu tiếp xúc mượt mà`
        : `⌒ <b>Cung Tiếp Tuyến:</b> Kéo chuột và click điểm kết thúc cung`;
    } else if (this.tool === 'circle') {
      const step = this.pendingPoints.length + 1;
      toolHint = `⭕ <b>Đường Tròn:</b> ${step === 1 ? 'Click chọn TÂM' : 'Click chọn BÁN KÍNH'}`;
    } else if (this.tool === 'fillet') {
      toolHint = !this.filletFirst
        ? `🔄 <b>Bo Cung (Fillet R = ${this.filletRadius}):</b> Click chọn Nét thứ 1`
        : `🔄 <b>Bo Cung (Fillet R = ${this.filletRadius}):</b> Click chọn Nét thứ 2 để bo tròn tiếp xúc góc`;
    } else if (this.tool === 'dim') {
      toolHint = `📐 <b>Đo Kích Thước:</b> Click 2 điểm để đo khoảng cách, hoặc click thẳng vào cung/tròn để đo bán kính R`;
    } else if (this.tool === 'dim-radial') {
      toolHint = `⭕ <b>Đo Bán Kính (R) / Đường Kính (Ø):</b> Click vào Cung Tròn hoặc Đường Tròn bất kỳ`;
    } else if (this.tool === 'erase') {
      toolHint = `✂️ <b>Tỉa Nét Cắt (AutoCAD TRIM):</b> Click vào đoạn nét (trong hoặc ngoài các giao điểm) để cắt tỉa`;
    } else if (this.tool === 'toggle-style') {
      toolHint = `🔄 <b>Đổi Nét (Thấy ⇄ Khuất):</b> Click vào nét bất kỳ để chuyển đổi giữa nét liền trắng (thấy) và nét đứt vàng (khuất)`;
    } else if (this.tool === 'pan') {
      toolHint = `✋ <b>Di Chuyển / Pan:</b> Kéo chuột trái để di chuyển mặt phẳng vẽ | Cuộn chuột để Phóng to/Thu nhỏ`;
    }

    hintEl.innerHTML = `${toolHint} &nbsp;|&nbsp; Bắt dính: ${snapModeText} (Phím <b>G</b>/giữ <b>Alt</b>)`;
  }

  // --- RENDER BẢN VẼ 2D MẶT PHẲNG X-Y RỘNG VÔ CỰC ---
  render() {
    if (!this.isVisible || !this.ctx) return;

    const ctx = this.ctx;
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const { w, h } = this.bounds;
    const s = this.scale;

    // 1. Nền không gian vẽ CAD đậm chất kỹ thuật
    ctx.fillStyle = '#080c15';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Phạm vi lưới hiển thị trên màn hình hiện tại
    const minU = Math.floor((-this.offsetX) / s) - 1;
    const maxU = Math.ceil((rect.width - this.offsetX) / s) + 1;
    const maxV = Math.ceil((this.offsetY) / s) + 1;
    const minV = Math.floor((this.offsetY - rect.height) / s) - 1;

    // 2. Lưới ô phụ (Subgrid) trải rộng khắp màn hình
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (let u = minU; u <= maxU; u++) {
      ctx.beginPath();
      ctx.moveTo(this.offsetX + u * s, 0);
      ctx.lineTo(this.offsetX + u * s, rect.height);
      ctx.stroke();
    }
    for (let v = minV; v <= maxV; v++) {
      ctx.beginPath();
      ctx.moveTo(0, this.offsetY - v * s);
      ctx.lineTo(rect.width, this.offsetY - v * s);
      ctx.stroke();
    }

    // Chấm nút lưới bắt dính
    ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
    for (let u = minU; u <= maxU; u++) {
      for (let v = minV; v <= maxV; v++) {
        ctx.beginPath();
        ctx.arc(this.offsetX + u * s, this.offsetY - v * s, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 3. TRỤC TỌA ĐỘ X VÀ Y ĐẬM NÉT (ĐẬM HƠN TRỤC X, Y THEO YÊU CẦU)
    // Trục X (Màu xanh cyan sáng, nét dày 3px)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(0, this.offsetY);
    ctx.lineTo(rect.width, this.offsetY);
    ctx.stroke();

    // Mũi tên trục X
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(rect.width - 25, this.offsetY - 6);
    ctx.lineTo(rect.width - 10, this.offsetY);
    ctx.lineTo(rect.width - 25, this.offsetY + 6);
    ctx.fill();
    ctx.font = 'bold 14px monospace';
    ctx.fillText('X', rect.width - 20, this.offsetY - 12);

    // Trục Y (Màu xanh cyan sáng, nét dày 3px)
    ctx.beginPath();
    ctx.moveTo(this.offsetX, 0);
    ctx.lineTo(this.offsetX, rect.height);
    ctx.stroke();

    // Mũi tên trục Y
    ctx.beginPath();
    ctx.moveTo(this.offsetX - 6, 25);
    ctx.lineTo(this.offsetX, 10);
    ctx.lineTo(this.offsetX + 6, 25);
    ctx.fill();
    ctx.fillText('Y', this.offsetX + 12, 20);

    // Điểm gốc tọa độ O(0, 0)
    ctx.beginPath();
    ctx.arc(this.offsetX, this.offsetY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f43f5e';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#f43f5e';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('O(0,0)', this.offsetX - 8, this.offsetY + 8);

    // Các vạch số trên trục X
    ctx.font = '11px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let u = minU; u <= maxU; u++) {
      if (u === 0) continue;
      // Vạch chia
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.offsetX + u * s, this.offsetY - 4);
      ctx.lineTo(this.offsetX + u * s, this.offsetY + 4);
      ctx.stroke();

      ctx.fillText(u, this.offsetX + u * s, this.offsetY + 8);
    }

    // Các vạch số trên trục Y
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = minV; v <= maxV; v++) {
      if (v === 0) continue;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.offsetX - 4, this.offsetY - v * s);
      ctx.lineTo(this.offsetX + 4, this.offsetY - v * s);
      ctx.stroke();

      ctx.fillText(v, this.offsetX - 10, this.offsetY - v * s);
    }

    // 5. VẼ CÁC ĐỐI TƯỢNG HÌNH HỌC (LINES, ARCS, CIRCLES, DIMS)
    for (const elem of this.elements) {
      if (elem.type === 'line') {
        const x1 = this.offsetX + elem.p1.u * s;
        const y1 = this.offsetY - elem.p1.v * s;
        const x2 = this.offsetX + elem.p2.u * s;
        const y2 = this.offsetY - elem.p2.v * s;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (elem.style === 'hidden') {
          ctx.strokeStyle = '#facc15'; // Nét đứt vàng
          ctx.lineWidth = 2.2;
          ctx.setLineDash([7, 4]);
        } else {
          ctx.strokeStyle = '#f8fafc'; // Nét liền trắng đậm
          ctx.lineWidth = 2.8;
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

      } else if (elem.type === 'circle') {
        const cx = this.offsetX + elem.cx * s;
        const cy = this.offsetY - elem.cy * s;
        const r = elem.r * s;

        // Dấu cộng tâm kỹ thuật (Center Mark)
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 3, 2, 3]);
        ctx.beginPath();
        ctx.moveTo(cx - r - 8, cy);
        ctx.lineTo(cx + r + 8, cy);
        ctx.moveTo(cx, cy - r - 8);
        ctx.lineTo(cx, cy + r + 8);
        ctx.stroke();
        ctx.setLineDash([]);

        // Đường tròn
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = (elem.style === 'hidden') ? '#facc15' : '#f8fafc';
        ctx.lineWidth = 2.8;
        if (elem.style === 'hidden') ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Chấm tâm
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();

      } else if (elem.type === 'arc') {
        const cx = this.offsetX + elem.cx * s;
        const cy = this.offsetY - elem.cy * s;
        const r = elem.r * s;

        // Dấu cộng tâm nhỏ cho cung
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx - 6, cy);
        ctx.lineTo(cx + 6, cy);
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx, cy + 6);
        ctx.stroke();

        // Cung chuẩn CCW: Trên Canvas (trục Y hướng xuống) đảo góc và dùng counterclockwise = true
        ctx.beginPath();
        ctx.arc(cx, cy, r, -elem.startAngle, -elem.endAngle, true);
        ctx.strokeStyle = (elem.style === 'hidden') ? '#facc15' : '#f8fafc';
        ctx.lineWidth = 2.8;
        if (elem.style === 'hidden') ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

      } else if (elem.type === 'dim') {
        // Vẽ kích thước (Dimension line)
        const x1 = this.offsetX + elem.p1.u * s;
        const y1 = this.offsetY - elem.p1.v * s;
        const x2 = this.offsetX + elem.p2.u * s;
        const y2 = this.offsetY - elem.p2.v * s;

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Mũi tên 2 đầu
        ctx.beginPath();
        ctx.arc(x1, y1, 3, 0, Math.PI * 2);
        ctx.arc(x2, y2, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();

        // Chữ số đo
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${elem.dist}`, midX, midY - 6);

      } else if (elem.type === 'dim-radial') {
        const cx = this.offsetX + elem.cx * s;
        const cy = this.offsetY - elem.cy * s;
        const angle = elem.angle;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const px = cx + elem.r * cosA * s;
        const py = cy - elem.r * sinA * s;

        const leaderLen = 30;
        const lx = px + leaderLen * cosA;
        const ly = py - leaderLen * sinA;
        const doglegX = lx + (cosA >= 0 ? 25 : -25);
        const doglegY = ly;

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(lx, ly);
        ctx.lineTo(doglegX, doglegY);
        ctx.stroke();

        const arrLen = 8;
        const backAngle = Math.atan2(cy - py, cx - px);
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + arrLen * Math.cos(backAngle - 0.35), py + arrLen * Math.sin(backAngle - 0.35));
        ctx.lineTo(px + arrLen * Math.cos(backAngle + 0.35), py + arrLen * Math.sin(backAngle + 0.35));
        ctx.fill();

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy);
        ctx.lineTo(cx + 5, cy);
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx, cy + 5);
        ctx.stroke();

        const labelText = elem.isDiameter ? `Ø ${elem.dist}` : `R ${elem.dist}`;
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = (cosA >= 0) ? 'left' : 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(labelText, doglegX + (cosA >= 0 ? 4 : -4), doglegY - 2);
      }
    }

    // Highlight nét thứ nhất đang chọn bo góc (Fillet)
    if (this.filletFirst && this.filletFirst.elem) {
      const fElem = this.filletFirst.elem;
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 4.5;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.8)';
      ctx.shadowBlur = 12;
      if (fElem.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(this.offsetX + fElem.p1.u * s, this.offsetY - fElem.p1.v * s);
        ctx.lineTo(this.offsetX + fElem.p2.u * s, this.offsetY - fElem.p2.v * s);
        ctx.stroke();
      } else if (fElem.type === 'circle') {
        ctx.beginPath();
        ctx.arc(this.offsetX + fElem.cx * s, this.offsetY - fElem.cy * s, fElem.r * s, 0, Math.PI * 2);
        ctx.stroke();
      } else if (fElem.type === 'arc') {
        ctx.beginPath();
        ctx.arc(this.offsetX + fElem.cx * s, this.offsetY - fElem.cy * s, fElem.r * s, -fElem.startAngle, -fElem.endAngle, true);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 6. XEM TRƯỚC NÉT VẼ ĐANG CHỜ (LIVE PREVIEW THEO CHUỘT)
    if (this.pendingPoints.length > 0 && this.hoverSnap) {
      const p1 = this.pendingPoints[0];
      const p2 = this.hoverSnap;

      const x1 = p1.canvasX;
      const y1 = p1.canvasY;
      const x2 = p2.canvasX;
      const y2 = p2.canvasY;

      // Điểm mốc đã click
      ctx.beginPath();
      ctx.arc(x1, y1, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#f43f5e';
      ctx.fill();

      if (this.tool === 'line-visible' || this.tool === 'line-hidden' || this.tool === 'dim') {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = (this.tool === 'line-hidden') ? '#facc15' : '#f43f5e';
        ctx.lineWidth = 2.4;
        if (this.tool === 'line-hidden') ctx.setLineDash([7, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Live đo kích thước độ dài L và gia số tọa độ
        const dx = Math.abs(p2.u - p1.u);
        const dy = Math.abs(p2.v - p1.v);
        const len = Math.hypot(p2.u - p1.u, p2.v - p1.v);
        const badgeX = (x1 + x2) / 2;
        const badgeY = (y1 + y2) / 2 - 12;

        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        const liveText = `L: ${len.toFixed(2)} | ΔX: ${dx.toFixed(2)}, ΔY: ${dy.toFixed(2)}`;
        ctx.font = 'bold 11px monospace';
        const textW = ctx.measureText(liveText).width;
        ctx.fillRect(badgeX - textW / 2 - 6, badgeY - 14, textW + 12, 20);
        ctx.strokeRect(badgeX - textW / 2 - 6, badgeY - 14, textW + 12, 20);
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(liveText, badgeX, badgeY - 4);
        ctx.restore();

      } else if (this.tool === 'circle') {
        const rVal = Math.hypot(p2.u - p1.u, p2.v - p1.v);
        const rPix = rVal * s;
        ctx.beginPath();
        ctx.arc(x1, y1, rPix, 0, Math.PI * 2);
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Live đo bán kính và đường kính
        ctx.save();
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        const liveText = `R: ${rVal.toFixed(2)} | Ø: ${(rVal * 2).toFixed(2)}`;
        ctx.font = 'bold 11px monospace';
        const textW = ctx.measureText(liveText).width;
        ctx.fillRect(x2 + 10, y2 - 25, textW + 12, 20);
        ctx.strokeRect(x2 + 10, y2 - 25, textW + 12, 20);
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(liveText, x2 + 16, y2 - 15);
        ctx.restore();

      } else if (this.tool === 'arc') {
        if (this.pendingPoints.length === 1) {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else if (this.pendingPoints.length === 2) {
          const A = this.pendingPoints[0];
          const B = this.pendingPoints[1];
          const C = p2;
          const circleParams = this.calculateCircleFrom3Points(A, B, C);
          if (circleParams) {
            const arcObj = this.makeCCWArc(circleParams.cx, circleParams.cy, circleParams.r, A, B, C);
            const cx = this.offsetX + arcObj.cx * s;
            const cy = this.offsetY - arcObj.cy * s;
            const r = arcObj.r * s;
            ctx.beginPath();
            ctx.arc(cx, cy, r, -arcObj.startAngle, -arcObj.endAngle, true);
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 2.4;
            ctx.stroke();
          }
        }
      } else if (this.tool === 'rect') {
        const xMin = Math.min(x1, x2);
        const yMin = Math.min(y1, y2);
        const wPix = Math.abs(x2 - x1);
        const hPix = Math.abs(y2 - y1);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(xMin, yMin, wPix, hPix);
        ctx.setLineDash([]);

        const wUnit = Math.abs(p2.u - p1.u).toFixed(2);
        const hUnit = Math.abs(p2.v - p1.v).toFixed(2);
        const text = `${wUnit} × ${hUnit}`;
        ctx.save();
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.fillText(text, (x1 + x2) / 2, Math.min(y1, y2) - 8);
        ctx.restore();

      } else if (this.tool === 'tangent-arc' && this.tangentStartVec) {
        const P0 = p1;
        const P1 = p2;
        const T0 = this.tangentStartVec;
        const dx = P1.u - P0.u;
        const dy = P1.v - P0.v;
        const dist2 = dx * dx + dy * dy;
        const N0 = { u: -T0.v, v: T0.u };
        const dot = dx * N0.u + dy * N0.v;
        if (Math.abs(dot) > 1e-4 && dist2 > 0.05) {
          const R = dist2 / (2 * dot);
          const cx = this.offsetX + (P0.u + R * N0.u) * s;
          const cy = this.offsetY - (P0.v + R * N0.v) * s;
          const r = Math.abs(R) * s;
          const a0 = Math.atan2(P0.v - (P0.v + R * N0.v), P0.u - (P0.u + R * N0.u));
          const a1 = Math.atan2(P1.v - (P0.v + R * N0.v), P1.u - (P0.u + R * N0.u));
          ctx.beginPath();
          ctx.arc(cx, cy, r, -a0, -a1, (R > 0));
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 2.4;
          ctx.stroke();
        }
      }
    }

    // 7. CON TRỎ BẮT DÍNH THÔNG MINH (SMART OSNAP GLYPHS & COORDINATES)
    if (this.hoverSnap) {
      const snap = this.hoverSnap;
      const hx = snap.canvasX;
      const hy = snap.canvasY;

      ctx.save();
      if (snap.snapType === 'endpoint' || snap.snapType === 'corner') {
        // Hình vuông xanh lá (□ Endpoint)
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2.0;
        ctx.strokeRect(hx - 5, hy - 5, 10, 10);
      } else if (snap.snapType === 'midpoint') {
        // Hình quả trám cyan (◇ Midpoint)
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(hx, hy - 6);
        ctx.lineTo(hx + 6, hy);
        ctx.lineTo(hx, hy + 6);
        ctx.lineTo(hx - 6, hy);
        ctx.closePath();
        ctx.stroke();
      } else if (snap.snapType === 'center') {
        // Hình tròn vàng có tâm (○ Center)
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(hx, hy, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#eab308';
        ctx.beginPath();
        ctx.arc(hx, hy, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (snap.snapType === 'quadrant') {
        // Hình thoi cam (◇ Quadrant)
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(hx, hy - 5);
        ctx.lineTo(hx + 5, hy);
        ctx.lineTo(hx, hy + 5);
        ctx.lineTo(hx - 5, hy);
        ctx.closePath();
        ctx.stroke();
      } else if (snap.snapType === 'nearest') {
        // Biểu tượng đồng hồ cát Nearest AutoCAD (⧗ Trên Cung / Nét)
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(hx - 5, hy - 5);
        ctx.lineTo(hx + 5, hy + 5);
        ctx.lineTo(hx - 5, hy + 5);
        ctx.lineTo(hx + 5, hy - 5);
        ctx.closePath();
        ctx.stroke();
      } else if (snap.snapType === 'free') {
        // Vòng tròn vàng tự do (Freeform)
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Chấm tròn bắt dính ô lưới mặc định
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Tooltip tọa độ & loại bắt dính OSNAP
      const snapText = snap.label ? `${snap.label} (X: ${snap.u}, Y: ${snap.v})` : `(X: ${snap.u}, Y: ${snap.v})`;
      ctx.font = 'bold 11px sans-serif';
      const snapTW = ctx.measureText(snapText).width;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(hx + 10, hy - 22, snapTW + 10, 18);
      ctx.strokeStyle = (snap.snapType && snap.snapType !== 'grid') ? '#22c55e' : 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(hx + 10, hy - 22, snapTW + 10, 18);

      ctx.fillStyle = (snap.snapType && snap.snapType !== 'grid') ? '#4ade80' : '#38bdf8';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(snapText, hx + 15, hy - 13);
      ctx.restore();
    }
  }

  // Xuất bản vẽ X-Y sang file AutoCAD (.DXF)
  exportDXF() {
    const visibleLines = [];
    const hiddenLines = [];
    const circles = [];
    const arcs = [];

    for (const elem of this.elements) {
      if (elem.type === 'line') {
        if (elem.style === 'hidden') hiddenLines.push(elem);
        else visibleLines.push(elem);
      } else if (elem.type === 'circle') {
        circles.push(elem);
      } else if (elem.type === 'arc') {
        arcs.push(elem);
      } else if (elem.type === 'dim-radial') {
        const cosA = Math.cos(elem.angle);
        const sinA = Math.sin(elem.angle);
        const px = elem.cx + elem.r * cosA;
        const py = elem.cy + elem.r * sinA;
        const lx = px + 0.8 * cosA;
        const ly = py + 0.8 * sinA;
        visibleLines.push({ p1: { u: elem.cx, v: elem.cy }, p2: { u: lx, v: ly } });
      } else if (elem.type === 'dim') {
        visibleLines.push({ p1: elem.p1, p2: elem.p2 });
      }
    }

    DXFExporter.downloadPlaneDXF({
      visibleLines,
      hiddenLines,
      circles,
      arcs,
      planeName: 'MAT_DUNG_XY',
      bounds: this.bounds
    }, `ban_ve_2d_XY_${this.bounds.w}x${this.bounds.h}.dxf`);
  }

  // Xuất bản vẽ X-Y sang file ảnh kỹ thuật cao (.PNG) chuẩn A4
  exportPNG() {
    const exportCanvas = document.createElement('canvas');
    const width = 2480;
    const height = 1754; // A4 Landscape @ 300 DPI
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    // 1. Nền giấy trắng bản vẽ kỹ thuật
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 2. Khung viền bản vẽ kỹ thuật tiêu chuẩn (Border Frame)
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeRect(40, 40, width - 80, height - 80);
    // Khung trong có lề đóng gáy 25mm (gáy trái 90px)
    ctx.lineWidth = 6;
    ctx.strokeRect(90, 55, width - 145, height - 110);

    // 3. Khung tên bản vẽ kỹ thuật (Title Block) góc dưới bên phải
    const tbW = 620;
    const tbH = 160;
    const tbX = width - 55 - tbW;
    const tbY = height - 55 - tbH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tbX, tbY, tbW, tbH);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeRect(tbX, tbY, tbW, tbH);

    // Phân dòng khung tên
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tbX, tbY + 50);
    ctx.lineTo(tbX + tbW, tbY + 50);
    ctx.moveTo(tbX, tbY + 105);
    ctx.lineTo(tbX + tbW, tbY + 105);
    ctx.moveTo(tbX + 380, tbY + 50);
    ctx.lineTo(tbX + 380, tbY + tbH);
    ctx.moveTo(tbX + 490, tbY + 50);
    ctx.lineTo(tbX + 490, tbY + tbH);
    ctx.stroke();

    // Chữ trong khung tên
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px "Segoe UI", sans-serif';
    ctx.fillText('BẢN VẼ CHI TIẾT 2D (MẶT ĐỨNG X-Y)', tbX + 20, tbY + 26);

    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Vật liệu:', tbX + 20, tbY + 72);
    ctx.font = 'bold 17px "Segoe UI", sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('Thép Kỹ Thuật (Block)', tbX + 90, tbY + 72);

    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Kích thước:', tbX + 20, tbY + 130);
    ctx.font = 'bold 17px "Segoe UI", sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`${this.bounds.w} x ${this.bounds.h} x ${this.bounds.d} cm`, tbX + 110, tbY + 130);

    ctx.font = '15px "Segoe UI", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Tỉ lệ:', tbX + 395, tbY + 72);
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('1:1', tbX + 438, tbY + 72);

    ctx.font = '15px "Segoe UI", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Ngày xuất:', tbX + 395, tbY + 130);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(new Date().toLocaleDateString('vi-VN'), tbX + 400, tbY + 148);

    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    ctx.fillStyle = '#0284c7';
    ctx.textAlign = 'center';
    ctx.fillText('CAD 2.0', tbX + 555, tbY + 95);

    // 4. Tính toán vùng vẽ và hệ số tỉ lệ (Scale & Center)
    const drawMinX = 140;
    const drawMaxX = width - 100;
    const drawMinY = 90;
    const drawMaxY = height - 190;
    const drawW = drawMaxX - drawMinX;
    const drawH = drawMaxY - drawMinY;

    // Tìm bounding box của vật thể và các nét vẽ
    let minU = 0, maxU = this.bounds.w;
    let minV = 0, maxV = this.bounds.h;

    for (const elem of this.elements) {
      if (elem.type === 'line' || elem.type === 'dim') {
        minU = Math.min(minU, elem.p1.u, elem.p2.u);
        maxU = Math.max(maxU, elem.p1.u, elem.p2.u);
        minV = Math.min(minV, elem.p1.v, elem.p2.v);
        maxV = Math.max(maxV, elem.p1.v, elem.p2.v);
      } else if (elem.type === 'circle') {
        minU = Math.min(minU, elem.cx - elem.r);
        maxU = Math.max(maxU, elem.cx + elem.r);
        minV = Math.min(minV, elem.cy - elem.r);
        maxV = Math.max(maxV, elem.cy + elem.r);
      } else if (elem.type === 'arc') {
        minU = Math.min(minU, elem.cx - elem.r);
        maxU = Math.max(maxU, elem.cx + elem.r);
        minV = Math.min(minV, elem.cy - elem.r);
        maxV = Math.max(maxV, elem.cy + elem.r);
      }
    }

    const marginUnits = 1.5;
    minU -= marginUnits;
    maxU += marginUnits;
    minV -= marginUnits;
    maxV += marginUnits;

    const spanU = Math.max(2, maxU - minU);
    const spanV = Math.max(2, maxV - minV);

    const scaleExport = Math.min(drawW / spanU, drawH / spanV) * 0.88;
    const centerDrawX = (drawMinX + drawMaxX) / 2;
    const centerDrawY = (drawMinY + drawMaxY) / 2;
    const centerU = (minU + maxU) / 2;
    const centerV = (minV + maxV) / 2;

    const toCanvasX = (u) => centerDrawX + (u - centerU) * scaleExport;
    const toCanvasY = (v) => centerDrawY - (v - centerV) * scaleExport;

    // 5. Lưới kỹ thuật nhạt
    const gridMinU = Math.floor(minU);
    const gridMaxU = Math.ceil(maxU);
    const gridMinV = Math.floor(minV);
    const gridMaxV = Math.ceil(maxV);

    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1.5;
    for (let u = gridMinU; u <= gridMaxU; u++) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(u), toCanvasY(gridMinV));
      ctx.lineTo(toCanvasX(u), toCanvasY(gridMaxV));
      ctx.stroke();
    }
    for (let v = gridMinV; v <= gridMaxV; v++) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(gridMinU), toCanvasY(v));
      ctx.lineTo(toCanvasX(gridMaxU), toCanvasY(v));
      ctx.stroke();
    }

    // 6. Khung bao vật thể phôi (Bounding block) nét mảnh
    const boxX1 = toCanvasX(0);
    const boxY1 = toCanvasY(this.bounds.h);
    const boxW = this.bounds.w * scaleExport;
    const boxH = this.bounds.h * scaleExport;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(boxX1, boxY1, boxW, boxH);
    ctx.setLineDash([]);

    // 7. Hệ trục tọa độ kỹ thuật X-Y
    const originX = toCanvasX(0);
    const originY = toCanvasY(0);

    // Trục X
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(toCanvasX(minU), originY);
    ctx.lineTo(toCanvasX(maxU) + 20, originY);
    ctx.stroke();

    // Mũi tên X
    ctx.fillStyle = '#0284c7';
    ctx.beginPath();
    const arrX = toCanvasX(maxU) + 20;
    ctx.moveTo(arrX, originY);
    ctx.lineTo(arrX - 16, originY - 7);
    ctx.lineTo(arrX - 16, originY + 7);
    ctx.fill();
    ctx.font = 'bold 22px monospace';
    ctx.fillText('X', arrX + 6, originY - 12);

    // Trục Y
    ctx.beginPath();
    ctx.moveTo(originX, toCanvasY(minV));
    ctx.lineTo(originX, toCanvasY(maxV) - 20);
    ctx.stroke();

    // Mũi tên Y
    const arrY = toCanvasY(maxV) - 20;
    ctx.beginPath();
    ctx.moveTo(originX, arrY);
    ctx.lineTo(originX - 7, arrY + 16);
    ctx.lineTo(originX + 7, arrY + 16);
    ctx.fill();
    ctx.fillText('Y', originX + 14, arrY + 6);

    // Gốc O(0,0)
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#e11d48';
    ctx.fillText('O(0,0)', originX - 35, originY + 28);

    // 8. Vẽ các đối tượng nét vẽ 2D
    for (const elem of this.elements) {
      if (elem.type === 'line') {
        const x1 = toCanvasX(elem.p1.u);
        const y1 = toCanvasY(elem.p1.v);
        const x2 = toCanvasX(elem.p2.u);
        const y2 = toCanvasY(elem.p2.v);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        if (elem.style === 'hidden') {
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 3.0;
          ctx.setLineDash([14, 8]);
        } else {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 4.8;
          ctx.setLineDash([]);
        }
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.setLineDash([]);

      } else if (elem.type === 'circle') {
        const cx = toCanvasX(elem.cx);
        const cy = toCanvasY(elem.cy);
        const r = elem.r * scaleExport;

        // Dấu tâm đỏ nét đứt kỹ thuật (Center Mark)
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([18, 5, 4, 5]);
        ctx.beginPath();
        ctx.moveTo(cx - r - 25, cy);
        ctx.lineTo(cx + r + 25, cy);
        ctx.moveTo(cx, cy - r - 25);
        ctx.lineTo(cx, cy + r + 25);
        ctx.stroke();
        ctx.setLineDash([]);

        // Đường tròn
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        if (elem.style === 'hidden') {
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 3.0;
          ctx.setLineDash([14, 8]);
        } else {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 4.8;
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

      } else if (elem.type === 'arc') {
        const cx = toCanvasX(elem.cx);
        const cy = toCanvasY(elem.cy);
        const r = elem.r * scaleExport;

        // Dấu tâm đỏ cho cung
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy);
        ctx.lineTo(cx + 12, cy);
        ctx.moveTo(cx, cy - 12);
        ctx.lineTo(cx, cy + 12);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, r, -elem.startAngle, -elem.endAngle, true);
        if (elem.style === 'hidden') {
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 3.0;
          ctx.setLineDash([14, 8]);
        } else {
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 4.8;
          ctx.setLineDash([]);
        }
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.setLineDash([]);

      } else if (elem.type === 'dim') {
        const x1 = toCanvasX(elem.p1.u);
        const y1 = toCanvasY(elem.p1.v);
        const x2 = toCanvasX(elem.p2.u);
        const y2 = toCanvasY(elem.p2.v);

        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Mũi tên 2 đầu
        ctx.beginPath();
        ctx.arc(x1, y1, 5, 0, Math.PI * 2);
        ctx.arc(x2, y2, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();

        // Chữ số đo
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        ctx.fillStyle = '#0284c7';
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${elem.dist}`, midX, midY - 10);

      } else if (elem.type === 'dim-radial') {
        const cx = toCanvasX(elem.cx);
        const cy = toCanvasY(elem.cy);
        const angle = elem.angle;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const px = cx + elem.r * cosA * scaleExport;
        const py = cy - elem.r * sinA * scaleExport;

        const leaderLen = 50;
        const lx = px + leaderLen * cosA;
        const ly = py - leaderLen * sinA;
        const doglegX = lx + (cosA >= 0 ? 40 : -40);
        const doglegY = ly;

        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(lx, ly);
        ctx.lineTo(doglegX, doglegY);
        ctx.stroke();

        // Mũi tên
        const arrLen = 12;
        const backAngle = Math.atan2(cy - py, cx - px);
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + arrLen * Math.cos(backAngle - 0.35), py + arrLen * Math.sin(backAngle - 0.35));
        ctx.lineTo(px + arrLen * Math.cos(backAngle + 0.35), py + arrLen * Math.sin(backAngle + 0.35));
        ctx.fill();

        // Dấu tâm nhỏ
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy);
        ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx, cy + 8);
        ctx.stroke();

        // Chữ R hoặc Ø
        const labelText = elem.isDiameter ? `Ø ${elem.dist}` : `R ${elem.dist}`;
        ctx.fillStyle = '#0284c7';
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = (cosA >= 0) ? 'left' : 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(labelText, doglegX + (cosA >= 0 ? 6 : -6), doglegY - 4);
      }
    }

    // Tải file PNG về máy người dùng
    const link = document.createElement('a');
    link.download = `ban_ve_ky_thuat_2d_XY_${this.bounds.w}x${this.bounds.h}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }
}
