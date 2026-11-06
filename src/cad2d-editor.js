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
    // 'line-visible', 'line-hidden', 'arc', 'circle', 'dim', 'erase', 'pan'
    this.tool = 'line-visible';

    // Bắt dính nửa ô (0.5 grid step)
    this.snapStep = 0.5;

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
    this.canvas.style.cursor = (this.tool === 'pan') ? 'grab' : 'crosshair';
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

  // --- TỌA ĐỘ VÀ BẮT DÍNH Ô LƯỚI ---
  getSnapPoint(screenX, screenY) {
    const s = this.scale;
    const uRaw = (screenX - this.offsetX) / s;
    const vRaw = -(screenY - this.offsetY) / s; // Y toán học hướng lên

    // Bắt dính bước 0.5 unit
    const step = this.snapStep;
    const uSnap = Math.round(uRaw / step) * step;
    const vSnap = Math.round(vRaw / step) * step;

    return {
      u: Number(uSnap.toFixed(2)),
      v: Number(vSnap.toFixed(2)),
      canvasX: this.offsetX + uSnap * s,
      canvasY: this.offsetY - vSnap * s
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
        const snap = this.getSnapPoint(mouseX, mouseY);
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
      } else if (e.key === 'Escape') {
        this.pendingPoints = [];
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

    // 2. Vẽ cung tròn 3 điểm (3-Point Arc)
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

    // 3. Vẽ đường tròn qua Tâm và Bán kính (Center + Radius)
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

    // 4. Đo kích thước 2D (Dimension)
    if (this.tool === 'dim') {
      if (this.pendingPoints.length === 0) {
        this.pendingPoints.push(snap);
      } else {
        const p1 = this.pendingPoints[0];
        const p2 = snap;
        const dist = Math.hypot(p2.u - p1.u, p2.v - p1.v);
        if (dist > 0.1) {
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

  updateHUDHint() {
    const hintEl = document.querySelector('.cad2d-hint');
    if (!hintEl) return;

    if (this.tool === 'line-visible') {
      hintEl.innerHTML = `✏️ <b>Vẽ Nét Thấy:</b> Click Điểm 1 ➔ Click Điểm 2 để nối nét liền đậm`;
    } else if (this.tool === 'line-hidden') {
      hintEl.innerHTML = `✏️ <b>Vẽ Nét Khuất:</b> Click 2 điểm để vẽ nét đứt vàng`;
    } else if (this.tool === 'arc') {
      const step = this.pendingPoints.length + 1;
      hintEl.innerHTML = `⌒ <b>Vẽ Cung Cong (3 Điểm):</b> Đang chờ Click <b>Điểm ${step}/3</b>`;
    } else if (this.tool === 'circle') {
      const step = this.pendingPoints.length + 1;
      hintEl.innerHTML = `⭕ <b>Đường Tròn:</b> ${step === 1 ? 'Click chọn TÂM' : 'Click chọn BÁN KÍNH'}`;
    } else if (this.tool === 'dim') {
      hintEl.innerHTML = `📐 <b>Đo Kích Thước:</b> Click 2 điểm để đo khoảng cách và tạo đường ghi kích thước`;
    } else if (this.tool === 'erase') {
      hintEl.innerHTML = `✂️ <b>Tỉa Nét Cắt (AutoCAD TRIM):</b> Click vào đoạn nét (trong hoặc ngoài các giao điểm) để cắt tỉa`;
    } else if (this.tool === 'pan') {
      hintEl.innerHTML = `✋ <b>Di Chuyển / Pan:</b> Kéo chuột trái để di chuyển mặt phẳng vẽ | Cuộn chuột để Phóng to/Thu nhỏ`;
    }
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

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2.8;
        ctx.stroke();

        // Chấm tâm
        ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();

      } else if (elem.type === 'arc') {
        const cx = this.offsetX + elem.cx * s;
        const cy = this.offsetY - elem.cy * s;
        const r = elem.r * s;

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
      }
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

      } else if (this.tool === 'circle') {
        const r = Math.hypot(p2.u - p1.u, p2.v - p1.v) * s;
        ctx.beginPath();
        ctx.arc(x1, y1, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

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
      }
    }

    // 7. CON TRỎ BẮT DÍNH HOVER (SNAP MARKER & COORDINATES)
    if (this.hoverSnap) {
      ctx.beginPath();
      ctx.arc(this.hoverSnap.canvasX, this.hoverSnap.canvasY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#38bdf8';
      ctx.textAlign = 'left';
      ctx.fillText(`(X: ${this.hoverSnap.u}, Y: ${this.hoverSnap.v})`, this.hoverSnap.canvasX + 10, this.hoverSnap.canvasY - 10);
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
}
