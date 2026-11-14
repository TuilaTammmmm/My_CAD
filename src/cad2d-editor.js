import { DXFExporter } from './dxf-exporter.js';
import { saveProjectState } from './storage.js';

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

    // Chế độ hiển thị khung bản vẽ CAD: 'none' (Tự do không khung) | 'block' (Khung phôi 3D) | 'a4' (Khung A4 ISO)
    this.frameMode = 'none';

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

    // Trạng thái số đo 2D & Bảng bên phải
    this.hoveredDim = null;
    this.highlightedDim = null;
    this.panelElement = document.getElementById('cad2d-inspect-panel');
    this.floatingBtn = document.getElementById('btn-floating-open-2d-inspect');
    this.measureListElement = document.getElementById('cad2d-measure-list');
    this.measureCountElement = document.getElementById('cad2d-measure-count');
    this.isCollapsed = (window.innerWidth <= 768);

    this.bindCanvasEvents();
    this.initInspectionPanel();
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
    this.updateFrameButton();
    this.render();
  }

  updateSnapButton() {
    const lbl = document.getElementById('lbl-snap-mode');
    const btn = document.getElementById('btn-2d-toggle-snap');
    if (lbl) {
      lbl.innerText = (this.snapMode === 'grid') ? 'Snap: Grid (0.5)' : 'Snap: Free';
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

  cycleFrameMode() {
    if (this.frameMode === 'none') {
      this.frameMode = 'block';
    } else if (this.frameMode === 'block') {
      this.frameMode = 'a4';
    } else {
      this.frameMode = 'none';
    }
    this.updateFrameButton();
    this.render();
  }

  updateFrameButton() {
    const lbl = document.getElementById('lbl-frame-mode');
    const btn = document.getElementById('btn-2d-toggle-frame');
    if (!lbl) return;
    if (this.frameMode === 'none') {
      lbl.innerText = 'Frame: Off (Free)';
      if (btn) {
        btn.classList.remove('active');
        btn.style.borderColor = '';
        btn.style.color = '';
      }
    } else if (this.frameMode === 'block') {
      const curW = this.currentViewW || this.bounds.w;
      const curH = this.currentViewH || this.bounds.h;
      lbl.innerText = `Frame: Stock (${curW}×${curH})`;
      if (btn) {
        btn.classList.add('active');
        btn.style.borderColor = '#38bdf8';
        btn.style.color = '#38bdf8';
      }
    } else if (this.frameMode === 'a4') {
      lbl.innerText = 'Frame: A4 (ISO)';
      if (btn) {
        btn.classList.add('active');
        btn.style.borderColor = '#10b981';
        btn.style.color = '#34d399';
      }
    }
  }

  loadSavedElements(elements, bounds) {
    if (elements && Array.isArray(elements)) {
      this.elements = elements;
      this.history = [JSON.parse(JSON.stringify(elements))];
      this.historyIndex = 0;
      if (bounds) this.bounds = bounds;
      this.updateUndoButtons();
      this.updateDimensionsList();
      this.render();
    }
  }

  triggerAutoSave() {
    saveProjectState('state_2d', {
      elements: this.elements,
      bounds: this.bounds,
      updatedAt: Date.now()
    });
  }

  saveHistory() {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(JSON.parse(JSON.stringify(this.elements)));
    this.historyIndex = this.history.length - 1;
    this.updateUndoButtons();
    this.updateDimensionsList();
    this.triggerAutoSave();
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.elements = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
      this.pendingPoints = [];
      this.filletFirst = null;
      this.tangentStartVec = null;
      this.updateHUDHint();
      this.updateUndoButtons();
      this.updateDimensionsList();
      this.render();
      this.triggerAutoSave();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.elements = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
      this.pendingPoints = [];
      this.filletFirst = null;
      this.tangentStartVec = null;
      this.updateHUDHint();
      this.updateUndoButtons();
      this.updateDimensionsList();
      this.render();
      this.triggerAutoSave();
    }
  }

  updateUndoButtons() {
    const btnUndo = document.getElementById('btn-2d-undo');
    const btnRedo = document.getElementById('btn-2d-redo');
    if (btnUndo) btnUndo.disabled = (this.historyIndex <= 0);
    if (btnRedo) btnRedo.disabled = (this.historyIndex >= this.history.length - 1);
  }

  // Khởi tạo bảng danh sách số đo bên phải cho 2D CAD
  initInspectionPanel() {
    this.panelElement = document.getElementById('cad2d-inspect-panel');
    this.floatingBtn = document.getElementById('btn-floating-open-2d-inspect');
    this.measureListElement = document.getElementById('cad2d-measure-list');
    this.measureCountElement = document.getElementById('cad2d-measure-count');

    // Nút thu gọn bảng
    document.getElementById('btn-toggle-2d-inspect')?.addEventListener('click', () => {
      this.collapsePanel();
    });

    // Nút nổi mở lại bảng
    this.floatingBtn?.addEventListener('click', () => {
      this.expandPanel();
    });

    // Nút xóa sạch toàn bộ số đo 2D
    document.getElementById('btn-clear-all-2d-dims')?.addEventListener('click', () => {
      this.clearAllDimensions();
    });

    // Nút copy danh sách số đo 2D
    document.getElementById('btn-copy-2d-dims')?.addEventListener('click', () => {
      this.copyDimensionsToClipboard();
    });

    // Các nút chuyển chế độ đo trên bảng bên phải
    this.panelElement?.querySelectorAll('.measure-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool');
        if (tool) this.setTool(tool);
      });
    });
  }

  collapsePanel() {
    this.isCollapsed = true;
    if (this.panelElement) this.panelElement.style.display = 'none';
    if (this.floatingBtn && this.isVisible) this.floatingBtn.style.display = 'flex';
  }

  expandPanel() {
    this.isCollapsed = false;
    if (this.panelElement && this.isVisible) this.panelElement.style.display = 'flex';
    if (this.floatingBtn) this.floatingBtn.style.display = 'none';
    this.updateDimensionsList();
  }

  clearAllDimensions() {
    const dims = this.elements.filter(e => e.type && e.type.startsWith('dim'));
    if (dims.length === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa toàn bộ ${dims.length} số đo trên bản vẽ 2D không?`)) return;
    this.elements = this.elements.filter(e => !e.type || !e.type.startsWith('dim'));
    this.hoveredDim = null;
    this.highlightedDim = null;
    this.saveHistory();
    this.render();
    this.updateDimensionsList();
  }

  copyDimensionsToClipboard() {
    const dims = this.elements.filter(e => e.type && e.type.startsWith('dim'));
    if (dims.length === 0) {
      alert('Chưa có số đo 2D nào để copy!');
      return;
    }
    const lines = ['--- DANH SÁCH SỐ ĐO 2D CAD ---'];
    dims.forEach((d, i) => {
      if (d.type === 'dim-radial') {
        const prefix = d.isDiameter ? 'Ø' : 'R';
        lines.push(`${i + 1}. ${prefix} = ${d.dist} (Tâm: ${d.cx.toFixed(1)}, ${d.cy.toFixed(1)})`);
      } else if (d.type === 'dim-angle') {
        lines.push(`${i + 1}. Góc = ${d.angle}°`);
      } else {
        lines.push(`${i + 1}. Chiều dài = ${d.dist} (Điểm 1: ${d.p1.u.toFixed(1)}, ${d.p1.v.toFixed(1)} ➔ Điểm 2: ${d.p2.u.toFixed(1)}, ${d.p2.v.toFixed(1)})`);
      }
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      alert(`Đã copy ${dims.length} số đo 2D vào Clipboard!`);
    }).catch(err => {
      console.warn('Clipboard write failed:', err);
    });
  }

  removeDimension(dimElem) {
    const idx = this.elements.indexOf(dimElem);
    if (idx !== -1) {
      this.elements.splice(idx, 1);
      if (this.hoveredDim === dimElem) this.hoveredDim = null;
      if (this.highlightedDim === dimElem) this.highlightedDim = null;
      this.saveHistory();
      this.render();
      this.updateDimensionsList();
    }
  }

  focusOnDimension(dim) {
    if (!dim) return;
    let targetU = 0, targetV = 0;
    if (dim.type === 'dim-radial') {
      targetU = dim.cx;
      targetV = dim.cy;
    } else if (dim.p1 && dim.p2) {
      targetU = (dim.p1.u + dim.p2.u) / 2;
      targetV = (dim.p1.v + dim.p2.v) / 2;
    }
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    this.offsetX = Math.round(rect.width / 2 - targetU * this.scale);
    this.offsetY = Math.round(rect.height / 2 + targetV * this.scale);
    this.highlightedDim = dim;
    this.render();
  }

  scrollToDimensionItem(dim) {
    if (!dim || !this.measureListElement) return;
    const dims = this.elements.filter(e => e.type && e.type.startsWith('dim'));
    const idx = dims.indexOf(dim);
    if (idx !== -1) {
      const itemEl = this.measureListElement.querySelector(`[data-dim-index="${idx}"]`);
      if (itemEl) {
        itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        itemEl.classList.add('selected');
        setTimeout(() => itemEl.classList.remove('selected'), 1500);
      }
    }
  }

  updateDimensionsList() {
    if (!this.measureListElement) return;
    const dims = this.elements.filter(e => e.type && e.type.startsWith('dim'));
    if (this.measureCountElement) {
      this.measureCountElement.textContent = dims.length;
    }

    if (dims.length === 0) {
      this.measureListElement.innerHTML = `
        <div class="empty-measure-hint">
          Chưa có số đo nào.<br>Chọn "Đo Cạnh" hoặc "2 Điểm" để tạo số đo trên bản vẽ!
        </div>
      `;
      return;
    }

    let html = '';
    dims.forEach((elem, idx) => {
      let icon = '📏';
      let title = '';
      let sub = '';

      if (elem.type === 'dim-radial') {
        icon = '⭕';
        if (elem.isDiameter) {
          title = `Đường Kính: Ø ${elem.dist}`;
          sub = `Tâm (${elem.cx.toFixed(1)}, ${elem.cy.toFixed(1)}) · R=${elem.r.toFixed(1)}`;
        } else {
          title = `Bán Kính: R ${elem.dist}`;
          sub = `Tâm (${elem.cx.toFixed(1)}, ${elem.cy.toFixed(1)})`;
        }
      } else if (elem.type === 'dim-angle') {
        icon = '📐';
        title = `Góc: ${elem.angle}°`;
        sub = `Góc giữa 2 đoạn nét`;
      } else {
        icon = '📏';
        const dx = Math.abs(elem.p2.u - elem.p1.u);
        const dy = Math.abs(elem.p2.v - elem.p1.v);
        let orientation = 'Xiên';
        if (dy < 0.05) orientation = 'Ngang (↔)';
        else if (dx < 0.05) orientation = 'Đứng (↕)';

        title = `Kích Thước: ${elem.dist} (${orientation})`;
        sub = `Từ (${elem.p1.u.toFixed(1)}, ${elem.p1.v.toFixed(1)}) đến (${elem.p2.u.toFixed(1)}, ${elem.p2.v.toFixed(1)})`;
      }

      html += `
        <div class="measure-item" data-dim-index="${idx}">
          <div class="measure-item-icon">${icon}</div>
          <div class="measure-item-info">
            <div class="measure-item-title">${title}</div>
            <div class="measure-item-sub">${sub}</div>
          </div>
          <button class="measure-item-del" data-dim-del="${idx}" title="Xóa số đo này (Delete)" aria-label="Xóa số đo">🗑️</button>
        </div>
      `;
    });

    this.measureListElement.innerHTML = html;

    // Gắn sự kiện xóa lẻ cho từng số đo
    this.measureListElement.querySelectorAll('.measure-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dIdx = parseInt(btn.getAttribute('data-dim-del'), 10);
        if (!isNaN(dIdx) && dims[dIdx]) {
          this.removeDimension(dims[dIdx]);
        }
      });
    });

    // Sự kiện hover và click vào từng mục trong danh sách
    this.measureListElement.querySelectorAll('.measure-item').forEach(itemEl => {
      const dIdx = parseInt(itemEl.getAttribute('data-dim-index'), 10);
      const targetDim = dims[dIdx];
      if (!targetDim) return;

      itemEl.addEventListener('mouseenter', () => {
        this.highlightedDim = targetDim;
        this.render();
      });
      itemEl.addEventListener('mouseleave', () => {
        if (this.highlightedDim === targetDim) {
          this.highlightedDim = null;
          this.render();
        }
      });
      itemEl.addEventListener('click', () => {
        this.focusOnDimension(targetDim);
      });
    });
  }

  // Tìm số đo tại tọa độ (u, v) - kiểm tra cả đường đo và text badge
  findDimensionAtPoint(pt) {
    if (!pt) return null;
    const clickThreshold = Math.max(0.45, 24 / this.scale);
    let bestDim = null;
    let bestDist = Infinity;

    for (let i = this.elements.length - 1; i >= 0; i--) {
      const elem = this.elements[i];
      if (!elem.type || !elem.type.startsWith('dim')) continue;

      let d = Infinity;
      if (elem.type === 'dim') {
        const dLine = this.pointToSegmentDistance(pt, elem.p1, elem.p2);

        // Khoảng cách tới text badge
        const dx = elem.p2.u - elem.p1.u;
        const dy = elem.p2.v - elem.p1.v;
        const len = Math.hypot(dx, dy);
        let dText = Infinity;
        if (len > 0.001) {
          let nx = -dy / len;
          let ny = dx / len;
          if (Math.abs(dx) >= Math.abs(dy)) {
            if (ny > 0) { nx = -nx; ny = -ny; }
          } else {
            if (nx > 0) { nx = -nx; ny = -ny; }
          }
          const offsetInUnits = 16 / this.scale;
          const textU = (elem.p1.u + elem.p2.u) / 2 + nx * offsetInUnits;
          const textV = (elem.p1.v + elem.p2.v) / 2 + ny * offsetInUnits;
          dText = Math.hypot(pt.u - textU, pt.v - textV);
        }
        d = Math.min(dLine, dText);
        if (dText <= (20 / this.scale)) {
          d = d * 0.1; // Ưu tiên tuyệt đối khi click trúng chữ số
        }
      } else if (elem.type === 'dim-radial') {
        const endU = elem.cx + (elem.r + 0.8) * Math.cos(elem.angle);
        const endV = elem.cy + (elem.r + 0.8) * Math.sin(elem.angle);
        const dLine = this.pointToSegmentDistance(pt, { u: elem.cx, v: elem.cy }, { u: endU, v: endV });
        const dText = Math.hypot(pt.u - endU, pt.v - endV);
        d = Math.min(dLine, dText);
        if (dText <= (20 / this.scale)) {
          d = d * 0.1;
        }
      }

      if (d < clickThreshold && d < bestDist) {
        bestDist = d;
        bestDim = elem;
      }
    }
    return bestDim;
  }

  setTool(toolName) {
    this.tool = toolName;
    this.pendingPoints = [];
    this.filletFirst = null;
    this.tangentStartVec = null;
    if (this.tool === 'pan') {
      this.canvas.style.cursor = 'grab';
    } else if (this.tool === 'toggle-style') {
      this.canvas.style.cursor = 'pointer';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }

    // Đồng bộ nút active ở sidebar trái và bảng bên phải
    document.querySelectorAll('.cad2d-tool-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tool') === toolName);
    });
    if (this.panelElement) {
      this.panelElement.querySelectorAll('.measure-mode-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-tool') === toolName);
      });
    }

    this.updateHUDHint();
    this.updateFrameButton();
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
    this.updateFrameButton();

    if (this.panelElement) {
      if (this.isCollapsed) {
        this.panelElement.style.display = 'none';
        if (this.floatingBtn) this.floatingBtn.style.display = 'flex';
      } else {
        this.panelElement.style.display = 'flex';
        if (this.floatingBtn) this.floatingBtn.style.display = 'none';
      }
    }
    this.updateDimensionsList();
    this.render();
  }

  hide() {
    this.isVisible = false;
    this.canvas.parentElement.style.display = 'none';
    if (this.panelElement) this.panelElement.style.display = 'none';
    if (this.floatingBtn) this.floatingBtn.style.display = 'none';
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
    const w = this.currentViewW || this.bounds.w;
    const h = this.currentViewH || this.bounds.h;

    if (this.currentViewType === 'all') {
      const targetPixelH = rect.height * 0.70;
      const targetPixelW = rect.width * 0.65;
      this.scale = Math.max(22, Math.min(65, Math.round(Math.min(targetPixelH / Math.max(4, h), targetPixelW / Math.max(5, w)))));
      this.offsetX = Math.round(rect.width * 0.32);
      this.offsetY = Math.round(rect.height * 0.82);
    } else {
      const targetPixelH = rect.height * 0.55;
      this.scale = Math.max(35, Math.min(85, Math.round(targetPixelH / Math.max(4, h))));
      this.offsetX = Math.round(rect.width * 0.38);
      this.offsetY = Math.round(rect.height * 0.72);
    }
  }

  // Nạp hình chiếu kỹ thuật 2D: 'all' (cả 3 hình chiếu cùng lúc) hoặc 'front', 'top', 'side'
  syncFrom3D(viewType = 'front') {
    if (!this.currentBrush) return;
    const proj = this.projectionEngine.generateProjections(this.currentBrush, this.bounds);
    this.currentViewType = viewType;

    const W = this.bounds.w;
    const H = this.bounds.h;
    const D = this.bounds.d;
    const GAP = Math.max(8, Math.round(Math.max(W, H, D) * 0.25));
    const labelOffset = Math.max(0.8, GAP * 0.18);

    this.elements = [];

    if (viewType === 'all') {
      // HIỂN THỊ CẢ 3 HÌNH CHIẾU CÙNG LÚC (3-VIEW TECHNICAL DRAWING)
      this.currentViewW = W + GAP + D;
      this.currentViewH = D + GAP + H;

      // 1. TOP VIEW (Đặt ở dưới cùng bên trái: [0, W] x [0, D])
      if (proj.top && proj.top.visible) {
        for (const line of proj.top.visible) {
          this.elements.push({
            type: 'line',
            style: 'visible',
            view: 'top',
            p1: { u: line.p1.u, v: line.p1.v },
            p2: { u: line.p2.u, v: line.p2.v }
          });
        }
      }
      this.elements.push({
        type: 'label',
        text: `TOP VIEW (${W}×${D})`,
        color: '#10b981',
        p: { u: W / 2, v: -labelOffset }
      });

      // 2. FRONT VIEW (Đặt ở trên Top View: [0, W] x [D + GAP, D + GAP + H])
      const frontYOffset = D + GAP;
      if (proj.front && proj.front.visible) {
        for (const line of proj.front.visible) {
          this.elements.push({
            type: 'line',
            style: 'visible',
            view: 'front',
            p1: { u: line.p1.u, v: line.p1.v + frontYOffset },
            p2: { u: line.p2.u, v: line.p2.v + frontYOffset }
          });
        }
      }
      this.elements.push({
        type: 'label',
        text: `FRONT VIEW (${W}×${H})`,
        color: '#38bdf8',
        p: { u: W / 2, v: frontYOffset + H + labelOffset }
      });

      // 3. RIGHT VIEW (Đặt bên phải Front View: [W + GAP, W + GAP + D] x [D + GAP, D + GAP + H])
      const rightXOffset = W + GAP;
      const rightData = proj.right || proj.side;
      if (rightData && rightData.visible) {
        for (const line of rightData.visible) {
          this.elements.push({
            type: 'line',
            style: 'visible',
            view: 'right',
            p1: { u: line.p1.u + rightXOffset, v: line.p1.v + frontYOffset },
            p2: { u: line.p2.u + rightXOffset, v: line.p2.v + frontYOffset }
          });
        }
      }
      this.elements.push({
        type: 'label',
        text: `RIGHT VIEW (${D}×${H})`,
        color: '#f59e0b',
        p: { u: rightXOffset + D / 2, v: frontYOffset + H + labelOffset }
      });

    } else {
      // HIỂN THỊ TỪNG HÌNH CHIẾU RIÊNG LẺ
      let viewData = proj[viewType];
      if (!viewData && (viewType === 'side' || viewType === 'right')) {
        viewData = proj.right || proj.side;
      }
      if (!viewData) viewData = proj.front;

      let viewW = W;
      let viewH = H;
      let viewLabel = `FRONT VIEW (${W}×${H})`;
      let labelColor = '#38bdf8';

      if (viewType === 'top') {
        viewW = W;
        viewH = D;
        viewLabel = `TOP VIEW (${W}×${D})`;
        labelColor = '#10b981';
      } else if (viewType === 'side' || viewType === 'right') {
        viewW = D;
        viewH = H;
        viewLabel = `RIGHT VIEW (${D}×${H})`;
        labelColor = '#f59e0b';
      }

      this.currentViewW = viewW;
      this.currentViewH = viewH;

      if (viewData && viewData.visible) {
        for (const line of viewData.visible) {
          this.elements.push({
            type: 'line',
            style: 'visible',
            view: viewType,
            p1: { u: line.p1.u, v: line.p1.v },
            p2: { u: line.p2.u, v: line.p2.v }
          });
        }
      }

      this.elements.push({
        type: 'label',
        text: viewLabel,
        color: labelColor,
        p: { u: viewW / 2, v: viewH + 0.45 }
      });
    }

    document.querySelectorAll('.tool-btn-sync').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewType);
    });

    this.updateFrameButton();
    this.saveHistory();
    this.centerView();
    this.render();
  }

  clearPlane() {
    this.elements = [];
    this.pendingPoints = [];
    this.filletFirst = null;
    this.tangentStartVec = null;
    this.updateHUDHint();
    this.saveHistory();
    this.render();
  }

  // --- TỌA ĐỘ VÀ BẮT DÍNH THÔNG MINH (SMART OSNAP & GRID SNAP) ---
  getSnapPoint(screenX, screenY, isAltOrFree = false) {
    const s = this.scale;
    const uRaw = (screenX - this.offsetX) / s;
    const vRaw = -(screenY - this.offsetY) / s; // Y toán học hướng lên

    // 1. Kiểm tra các điểm mốc hình học (Smart OSNAP: Đầu mút, Tâm, Trung điểm, Góc phôi)
    const candidates = [];
    const w = this.currentViewW || this.bounds.w;
    const h = this.currentViewH || this.bounds.h;
    candidates.push({ u: 0, v: 0, type: 'corner', label: 'Gốc O(0,0)' });
    if (this.frameMode === 'block') {
      candidates.push(
        { u: w, v: 0, type: 'corner', label: 'Góc phôi' },
        { u: w, v: h, type: 'corner', label: 'Góc phôi' },
        { u: 0, v: h, type: 'corner', label: 'Góc phôi' }
      );
    }

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

        // 1. Nếu đang ở công cụ Erase: click trúng số đo là xóa ngay lập tức
        if (this.tool === 'erase') {
          const clickedDim = this.findDimensionAtPoint(rawPoint);
          if (clickedDim) {
            this.removeDimension(clickedDim);
            return;
          }
        }

        // 2. Nếu đang ở công cụ đo và click vào số đo đã có: chọn và cuộn bảng bên phải
        if (this.tool === 'dim' || this.tool === 'dim-points' || this.tool === 'dim-radial') {
          const clickedDim = this.findDimensionAtPoint(rawPoint);
          if (clickedDim && this.pendingPoints.length === 0) {
            this.highlightedDim = clickedDim;
            this.render();
            this.scrollToDimensionItem(clickedDim);
            return;
          }
        }

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

      const rawU = Number(((mouseX - this.offsetX) / this.scale).toFixed(3));
      const rawV = Number((-(mouseY - this.offsetY) / this.scale).toFixed(3));
      const pt = { u: rawU, v: rawV };
      const prevHovered = this.hoveredDim;
      this.hoveredDim = this.findDimensionAtPoint(pt);

      if (this.hoveredDim !== prevHovered) {
        if (this.hoveredDim) {
          this.canvas.style.cursor = (this.tool === 'erase') ? 'not-allowed' : 'pointer';
        } else {
          this.canvas.style.cursor = (this.tool === 'pan') ? 'grab' : (this.tool === 'toggle-style' ? 'pointer' : 'crosshair');
        }
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
      const newScale = Math.max(2.0, Math.min(300, this.scale * factor));

      this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
      this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;

      this.render();
    }, { passive: false });

    // Hỗ trợ cảm ứng trên điện thoại (1 ngón tap/pan + 2 ngón pinch-zoom & pan)
    let touchState = {
      mode: 'none', // 'tap' | 'pan' | 'pinch'
      startX: 0,
      startY: 0,
      moved: false,
      pinchDist: 0,
      pinchMidX: 0,
      pinchMidY: 0
    };

    const getTouchPoint = (t) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    };

    this.canvas.addEventListener('touchstart', (e) => {
      if (!this.isVisible) return;
      e.preventDefault();

      if (e.touches.length === 1) {
        const pt = getTouchPoint(e.touches[0]);
        touchState.startX = pt.x;
        touchState.startY = pt.y;
        touchState.moved = false;
        if (this.tool === 'pan') {
          touchState.mode = 'pan';
          this.panStart = { x: pt.x - this.offsetX, y: pt.y - this.offsetY };
        } else {
          touchState.mode = 'tap';
          this.hoverSnap = this.getSnapPoint(pt.x, pt.y, false);
          this.render();
        }
      } else if (e.touches.length === 2) {
        const p1 = getTouchPoint(e.touches[0]);
        const p2 = getTouchPoint(e.touches[1]);
        touchState.mode = 'pinch';
        touchState.moved = true;
        touchState.pinchDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        touchState.pinchMidX = (p1.x + p2.x) / 2;
        touchState.pinchMidY = (p1.y + p2.y) / 2;
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isVisible) return;
      e.preventDefault();

      if (e.touches.length === 1 && touchState.mode !== 'pinch') {
        const pt = getTouchPoint(e.touches[0]);
        const moveDist = Math.hypot(pt.x - touchState.startX, pt.y - touchState.startY);
        if (moveDist > 8) touchState.moved = true;

        if (touchState.mode === 'pan') {
          this.offsetX = pt.x - this.panStart.x;
          this.offsetY = pt.y - this.panStart.y;
          this.render();
        } else {
          this.hoverSnap = this.getSnapPoint(pt.x, pt.y, false);
          this.render();
        }
      } else if (e.touches.length === 2) {
        const p1 = getTouchPoint(e.touches[0]);
        const p2 = getTouchPoint(e.touches[1]);
        const newDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        const newMidX = (p1.x + p2.x) / 2;
        const newMidY = (p1.y + p2.y) / 2;

        if (touchState.pinchDist > 5) {
          const factor = newDist / touchState.pinchDist;
          const newScale = Math.max(2.0, Math.min(300, this.scale * factor));
          const ratio = newScale / this.scale;

          this.offsetX = newMidX - (touchState.pinchMidX - this.offsetX) * ratio;
          this.offsetY = newMidY - (touchState.pinchMidY - this.offsetY) * ratio;
          this.scale = newScale;
        } else {
          this.offsetX += newMidX - touchState.pinchMidX;
          this.offsetY += newMidY - touchState.pinchMidY;
        }

        touchState.mode = 'pinch';
        touchState.moved = true;
        touchState.pinchDist = newDist;
        touchState.pinchMidX = newMidX;
        touchState.pinchMidY = newMidY;
        this.render();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      if (!this.isVisible) return;
      e.preventDefault();

      if (e.touches.length === 0) {
        if (touchState.mode === 'tap' && !touchState.moved && e.changedTouches.length > 0) {
          const pt = getTouchPoint(e.changedTouches[0]);
          const rawU = Number(((pt.x - this.offsetX) / this.scale).toFixed(3));
          const rawV = Number((-(pt.y - this.offsetY) / this.scale).toFixed(3));
          const snap = this.getSnapPoint(pt.x, pt.y, false);
          if (snap) {
            this.handleToolClick(snap, { u: rawU, v: rawV });
          }
        }
        touchState.mode = 'none';
      } else if (e.touches.length === 1) {
        // Tránh chạm nhầm click sau khi nhả 1 trong 2 ngón pinch
        touchState.mode = (this.tool === 'pan') ? 'pan' : 'none';
        touchState.moved = true;
      }
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
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.hoveredDim || this.highlightedDim) {
          e.preventDefault();
          this.removeDimension(this.hoveredDim || this.highlightedDim);
        }
      } else if (e.key === 'Escape') {
        this.pendingPoints = [];
        this.filletFirst = null;
        this.tangentStartVec = null;
        this.highlightedDim = null;
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
        const hintEl = document.querySelector('.cad2d-hint');
        if (hintEl) {
          hintEl.innerHTML = `✅ <b>Bo Cung (Fillet):</b> Đã bo tròn góc thành công với bán kính R = ${R}!`;
        }
      } else {
        const hintEl = document.querySelector('.cad2d-hint');
        if (hintEl) {
          hintEl.innerHTML = `⚠️ <b>Bo Cung (Fillet):</b> Không thể bo góc với R = ${R}. Hãy thử giảm bán kính R (ô nhập Bán kính R) hoặc chọn 2 nét cắt nhau!`;
        }
      }
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

      // Đo kích thước thẳng: Click vào cạnh bất kỳ để đo ngay chiều dài cạnh, hoặc click 2 điểm
      if (this.pendingPoints.length === 0) {
        let bestLine = null;
        let minLineDist = Math.max(0.35, 18 / this.scale);

        for (const elem of this.elements) {
          if (elem.type === 'line') {
            const dLine = this.pointToSegmentDistance(clickPoint, elem.p1, elem.p2);
            if (dLine < minLineDist) {
              minLineDist = dLine;
              bestLine = elem;
            }
          }
        }

        if (bestLine) {
          const chain = this.findCollinearChain(bestLine);
          const pStart = chain.p1;
          const pEnd = chain.p2;
          const dist = Math.hypot(pEnd.u - pStart.u, pEnd.v - pStart.v);
          if (dist > 0.05) {
            const existingDim = this.elements.find(e =>
              e.type === 'dim' &&
              ((Math.hypot(e.p1.u - pStart.u, e.p1.v - pStart.v) < 0.1 && Math.hypot(e.p2.u - pEnd.u, e.p2.v - pEnd.v) < 0.1) ||
               (Math.hypot(e.p1.u - pEnd.u, e.p1.v - pEnd.v) < 0.1 && Math.hypot(e.p2.u - pStart.u, e.p2.v - pStart.v) < 0.1))
            );
            if (!existingDim) {
              this.elements.push({
                type: 'dim',
                p1: { u: pStart.u, v: pStart.v },
                p2: { u: pEnd.u, v: pEnd.v },
                dist: Number(dist.toFixed(2))
              });
              this.saveHistory();
              this.render();
              return;
            }
          }
        }

        this.pendingPoints.push(snap);
      } else {
        const p1 = this.pendingPoints[0];
        const p2 = snap;
        const dist = Math.hypot(p2.u - p1.u, p2.v - p1.v);
        if (dist > 0.05) {
          const duplicate = this.elements.find(e =>
            e.type === 'dim' &&
            ((Math.hypot(e.p1.u - p1.u, e.p1.v - p1.v) < 0.1 && Math.hypot(e.p2.u - p2.u, e.p2.v - p2.v) < 0.1) ||
             (Math.hypot(e.p1.u - p2.u, e.p1.v - p2.v) < 0.1 && Math.hypot(e.p2.u - p1.u, e.p2.v - p1.v) < 0.1))
          );
          if (!duplicate) {
            this.elements.push({
              type: 'dim',
              p1, p2,
              dist: Number(dist.toFixed(2))
            });
            this.saveHistory();
          }
        }
        this.pendingPoints = [];
      }
      this.render();
      return;
    }

    // 7b. Đo 2 điểm riêng biệt 2D (Point-to-Point Dim)
    if (this.tool === 'dim-points') {
      if (this.pendingPoints.length === 0) {
        this.pendingPoints.push(snap);
      } else {
        const p1 = this.pendingPoints[0];
        const p2 = snap;
        const dist = Math.hypot(p2.u - p1.u, p2.v - p1.v);
        if (dist > 0.05) {
          const duplicate = this.elements.find(e =>
            e.type === 'dim' &&
            ((Math.hypot(e.p1.u - p1.u, e.p1.v - p1.v) < 0.1 && Math.hypot(e.p2.u - p2.u, e.p2.v - p2.v) < 0.1) ||
             (Math.hypot(e.p1.u - p2.u, e.p1.v - p2.v) < 0.1 && Math.hypot(e.p2.u - p1.u, e.p2.v - p1.v) < 0.1))
          );
          if (!duplicate) {
            this.elements.push({
              type: 'dim',
              p1, p2,
              dist: Number(dist.toFixed(2))
            });
            this.saveHistory();
          }
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
      if (bestElem && bestDist <= threshold && bestElem.type !== 'dim' && bestElem.type !== 'dim-radial' && bestElem.type !== 'label' && bestElem.style !== 'guide') {
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
    if (d < 1e-7) return [];

    const sumR = c1.r + c2.r;
    const diffR = Math.abs(c1.r - c2.r);

    // Bắt điểm tiếp xúc ngoài (External tangency)
    if (Math.abs(d - sumR) < 0.05) {
      const u = c1.cx + c1.r * (dx / d);
      const v = c1.cy + c1.r * (dy / d);
      const angle1 = this.normAngle(Math.atan2(v - c1.cy, u - c1.cx));
      const angle2 = this.normAngle(Math.atan2(v - c2.cy, u - c2.cx));
      return [{ u, v, angle1, angle2 }];
    }

    // Bắt điểm tiếp xúc trong (Internal tangency)
    if (Math.abs(d - diffR) < 0.05 && diffR > 1e-4) {
      const sign = (c1.r > c2.r) ? 1 : -1;
      const u = c1.cx + c1.r * (dx / d) * sign;
      const v = c1.cy + c1.r * (dy / d) * sign;
      const angle1 = this.normAngle(Math.atan2(v - c1.cy, u - c1.cx));
      const angle2 = this.normAngle(Math.atan2(v - c2.cy, u - c2.cx));
      return [{ u, v, angle1, angle2 }];
    }

    if (d > sumR || d < diffR) {
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
    // 1. ƯU TIÊN SỐ 1: Bắt dính và xóa số đo nếu click trúng bất kỳ số đo nào
    const targetDim = this.findDimensionAtPoint(clickPoint);
    if (targetDim) {
      this.removeDimension(targetDim);
      return;
    }

    let bestElem = null;
    let bestDist = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < this.elements.length; i++) {
      const elem = this.elements[i];
      if (elem.style === 'guide' || elem.type === 'label') continue;
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
      } else if (elem.type === 'dim-radial') {
        const endU = elem.cx + (elem.r + 0.8) * Math.cos(elem.angle);
        const endV = elem.cy + (elem.r + 0.8) * Math.sin(elem.angle);
        d = this.pointToSegmentDistance(clickPoint, { u: elem.cx, v: elem.cy }, { u: endU, v: endV });
      }

      if (d < bestDist) {
        bestDist = d;
        bestElem = elem;
        bestIndex = i;
      }
    }

    const clickThreshold = Math.max(0.45, 24 / this.scale);
    if (!bestElem || bestDist > clickThreshold) return;

    if (bestElem.type === 'dim' || bestElem.type === 'dim-radial') {
      this.elements.splice(bestIndex, 1);
      this.saveHistory();
      this.render();
      return;
    }

    const otherElements = this.elements.filter((_, idx) => idx !== bestIndex);

    // 1. TỈA ĐOẠN THẲNG (LINE)
    if (bestElem.type === 'line') {
      let tList = [0, 1];
      const dx = bestElem.p2.u - bestElem.p1.u;
      const dy = bestElem.p2.v - bestElem.p1.v;
      const len2 = dx * dx + dy * dy;

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

        // Bắt thêm các đầu mút nét khác chạm/tiếp xúc vào đoạn thẳng (như cung bo góc)
        const otherPts = [];
        if (other.type === 'line') otherPts.push(other.p1, other.p2);
        else if (other.type === 'arc') {
          otherPts.push(
            { u: other.cx + other.r * Math.cos(other.startAngle), v: other.cy + other.r * Math.sin(other.startAngle) },
            { u: other.cx + other.r * Math.cos(other.endAngle), v: other.cy + other.r * Math.sin(other.endAngle) }
          );
        }
        for (const pt of otherPts) {
          const dToSeg = this.pointToSegmentDistance(pt, bestElem.p1, bestElem.p2);
          if (dToSeg < 0.08 && len2 > 1e-6) {
            const t = ((pt.u - bestElem.p1.u) * dx + (pt.v - bestElem.p1.v) * dy) / len2;
            if (t > 1e-3 && t < 1 - 1e-3) {
              tList.push(t);
            }
          }
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

        // Bắt thêm các đầu mút nét khác chạm/tiếp xúc vào cung tròn (như tiếp điểm bo góc fillet)
        const otherPts = [];
        if (other.type === 'line') otherPts.push(other.p1, other.p2);
        else if (other.type === 'arc') {
          otherPts.push(
            { u: other.cx + other.r * Math.cos(other.startAngle), v: other.cy + other.r * Math.sin(other.startAngle) },
            { u: other.cx + other.r * Math.cos(other.endAngle), v: other.cy + other.r * Math.sin(other.endAngle) }
          );
        }
        for (const pt of otherPts) {
          const distToCenter = Math.hypot(pt.u - bestElem.cx, pt.v - bestElem.cy);
          if (Math.abs(distToCenter - bestElem.r) < 0.08) {
            const angle = this.normAngle(Math.atan2(pt.v - bestElem.cy, pt.u - bestElem.cx));
            if (this.isAngleOnArc(angle, bestElem.startAngle, bestElem.endAngle)) {
              angleList.push(angle);
            }
          }
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
    // Nếu chỉ truyền 2 điểm A, B (cho Fillet, Tangent-Arc)
    const is3Point = (typeof C === 'object' && C !== null && ('u' in C || 'v' in C));
    const arcStyle = is3Point ? (style || 'visible') : (typeof C === 'string' ? C : 'visible');

    if (!is3Point) {
      const a1 = this.normAngle(Math.atan2(A.v - cy, A.u - cx));
      const a2 = this.normAngle(Math.atan2(B.v - cy, B.u - cx));
      let sweep = this.normAngle(a2 - a1);

      // Luôn lấy cung nhỏ (minor arc <= PI) kết nối 2 tiếp điểm mượt mà
      if (sweep <= Math.PI) {
        return {
          type: 'arc',
          style: arcStyle,
          cx: Number(cx.toFixed(3)),
          cy: Number(cy.toFixed(3)),
          r: Number(r.toFixed(3)),
          startAngle: a1,
          endAngle: a2
        };
      } else {
        return {
          type: 'arc',
          style: arcStyle,
          cx: Number(cx.toFixed(3)),
          cy: Number(cy.toFixed(3)),
          r: Number(r.toFixed(3)),
          startAngle: a2,
          endAngle: a1
        };
      }
    }

    // Trường hợp 3 điểm: A (đầu), B (điểm đi qua), C (cuối)
    let aA = this.normAngle(Math.atan2(A.v - cy, A.u - cx));
    let aB = this.normAngle(Math.atan2(B.v - cy, B.u - cx));
    let aC = this.normAngle(Math.atan2(C.v - cy, C.u - cx));

    let sweepB = this.normAngle(aB - aA);
    let sweepC = this.normAngle(aC - aA);

    if (sweepB < sweepC) {
      return {
        type: 'arc',
        style: arcStyle,
        cx: Number(cx.toFixed(3)),
        cy: Number(cy.toFixed(3)),
        r: Number(r.toFixed(3)),
        startAngle: aA,
        endAngle: aC
      };
    } else {
      return {
        type: 'arc',
        style: arcStyle,
        cx: Number(cx.toFixed(3)),
        cy: Number(cy.toFixed(3)),
        r: Number(r.toFixed(3)),
        startAngle: aC,
        endAngle: aA
      };
    }
  }

  findCollinearChain(targetLine) {
    const du = targetLine.p2.u - targetLine.p1.u;
    const dv = targetLine.p2.v - targetLine.p1.v;
    const len = Math.hypot(du, dv);
    if (len < 0.001) return { p1: targetLine.p1, p2: targetLine.p2 };

    const dir = { u: du / len, v: dv / len };
    let minT = 0;
    let maxT = len;
    const p0 = targetLine.p1;

    for (const elem of this.elements) {
      if (elem.type !== 'line') continue;
      const edu = elem.p2.u - elem.p1.u;
      const edv = elem.p2.v - elem.p1.v;
      const elen = Math.hypot(edu, edv);
      if (elen < 0.001) continue;

      const edir = { u: edu / elen, v: edv / elen };
      const dot = Math.abs(dir.u * edir.u + dir.v * edir.v);
      if (dot < 0.998) continue;

      const cross1 = Math.abs(dir.u * (elem.p1.v - p0.v) - dir.v * (elem.p1.u - p0.u));
      const cross2 = Math.abs(dir.u * (elem.p2.v - p0.v) - dir.v * (elem.p2.u - p0.u));
      if (cross1 > 0.08 || cross2 > 0.08) continue;

      const t1 = (elem.p1.u - p0.u) * dir.u + (elem.p1.v - p0.v) * dir.v;
      const t2 = (elem.p2.u - p0.u) * dir.u + (elem.p2.v - p0.v) * dir.v;
      const segMin = Math.min(t1, t2);
      const segMax = Math.max(t1, t2);

      if (segMin <= maxT + 0.1 && segMax >= minT - 0.1) {
        minT = Math.min(minT, segMin);
        maxT = Math.max(maxT, segMax);
      }
    }

    return {
      p1: { u: Number((p0.u + minT * dir.u).toFixed(2)), v: Number((p0.v + minT * dir.v).toFixed(2)) },
      p2: { u: Number((p0.u + maxT * dir.u).toFixed(2)), v: Number((p0.v + maxT * dir.v).toFixed(2)) }
    };
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
      if (elem.style === 'guide' || elem.type === 'dim' || elem.type === 'dim-radial' || elem.type === 'label') continue;
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

    const clickThreshold = Math.max(0.8, 35 / this.scale);
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

      const lenA = Math.hypot(dAx, dAy);
      const lenB = Math.hypot(dBx, dBy);
      if (lenA < 1e-4 || lenB < 1e-4) return false;

      const uAx = dAx / lenA, uAy = dAy / lenA;
      const uBx = dBx / lenB, uBy = dBy / lenB;

      // Điểm giao nhau thực tế hoặc kéo dài của 2 đường thẳng
      const dx = elemB.p1.u - elemA.p1.u;
      const dy = elemB.p1.v - elemA.p1.v;
      const t = (dx * dBy - dy * dBx) / cross;
      const V = { u: elemA.p1.u + t * dAx, v: elemA.p1.v + t * dAy };

      // Hướng tia dọc theo đường thẳng A về phía click (đảm bảo song song 100% với nét ban đầu, không bị nghiêng nét)
      const sA = (ptA.u - V.u) * uAx + (ptA.v - V.v) * uAy;
      let vAx, vAy;
      if (Math.abs(sA) > 1e-4) {
        const sign = sA > 0 ? 1 : -1;
        vAx = sign * uAx;
        vAy = sign * uAy;
      } else {
        const dist1 = Math.hypot(elemA.p1.u - V.u, elemA.p1.v - V.v);
        const dist2 = Math.hypot(elemA.p2.u - V.u, elemA.p2.v - V.v);
        const farA = (dist1 > dist2) ? elemA.p1 : elemA.p2;
        const dF = Math.hypot(farA.u - V.u, farA.v - V.v);
        if (dF < 1e-4) return false;
        vAx = (farA.u - V.u) / dF;
        vAy = (farA.v - V.v) / dF;
      }

      // Hướng tia dọc theo đường thẳng B về phía click
      const sB = (ptB.u - V.u) * uBx + (ptB.v - V.v) * uBy;
      let vBx, vBy;
      if (Math.abs(sB) > 1e-4) {
        const sign = sB > 0 ? 1 : -1;
        vBx = sign * uBx;
        vBy = sign * uBy;
      } else {
        const dist1 = Math.hypot(elemB.p1.u - V.u, elemB.p1.v - V.v);
        const dist2 = Math.hypot(elemB.p2.u - V.u, elemB.p2.v - V.v);
        const farB = (dist1 > dist2) ? elemB.p1 : elemB.p2;
        const dF = Math.hypot(farB.u - V.u, farB.v - V.v);
        if (dF < 1e-4) return false;
        vBx = (farB.u - V.u) / dF;
        vBy = (farB.v - V.v) / dF;
      }

      const dot = Math.max(-0.9999, Math.min(0.9999, vAx * vBx + vAy * vBy));
      const theta = Math.acos(dot);
      if (theta < 0.05 || theta > Math.PI - 0.05) return false;

      const halfTheta = theta / 2;
      const dT = R / Math.tan(halfTheta);
      const dC = R / Math.sin(halfTheta);

      // Phân giác góc
      let bX = vAx + vBx, bY = vAy + vBy;
      const bLen = Math.hypot(bX, bY);
      if (bLen < 1e-4) return false;
      bX /= bLen; bY /= bLen;

      // Tâm cung tròn và các tiếp điểm
      const Cf = { u: V.u + dC * bX, v: V.v + dC * bY };
      const TA = { u: V.u + dT * vAx, v: V.v + dT * vAy };
      const TB = { u: V.u + dT * vBx, v: V.v + dT * vBy };

      // Tạo cung bo góc (2 điểm tiếp xúc, minor arc)
      const arcObj = this.makeCCWArc(Cf.u, Cf.v, R, TA, TB, 'visible');
      this.elements.push(arcObj);

      // Cắt ngắn (Trim) đoạn A từ đỉnh V lùi về tiếp điểm TA
      const projA1 = (elemA.p1.u - V.u) * vAx + (elemA.p1.v - V.v) * vAy;
      const projA2 = (elemA.p2.u - V.u) * vAx + (elemA.p2.v - V.v) * vAy;
      if (projA1 < projA2) {
        elemA.p1 = TA;
      } else {
        elemA.p2 = TA;
      }

      // Cắt ngắn (Trim) đoạn B từ đỉnh V lùi về tiếp điểm TB
      const projB1 = (elemB.p1.u - V.u) * vBx + (elemB.p1.v - V.v) * vBy;
      const projB2 = (elemB.p2.u - V.u) * vBx + (elemB.p2.v - V.v) * vBy;
      if (projB1 < projB2) {
        elemB.p1 = TB;
      } else {
        elemB.p2 = TB;
      }

      // Loại bỏ đoạn thẳng bị thu gọn thành điểm (độ dài ~ 0)
      this.elements = this.elements.filter(el =>
        el.type !== 'line' || Math.hypot(el.p2.u - el.p1.u, el.p2.v - el.p1.v) > 1e-4
      );

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
      const proj = projectPointOnLine({ u: curveElem.cx, v: curveElem.cy }, offP1, { u: offP1.u + uX, v: offP1.v + uY });
      const hDist = Math.hypot(curveElem.cx - proj.u, curveElem.cy - proj.v);

      const candidateCenters = [];
      for (const Roff of [Rc + R, Math.abs(Rc - R)]) {
        if (Roff >= hDist && Roff > 1e-4) {
          const dChord = Math.sqrt(Math.max(0, Roff * Roff - hDist * hDist));
          candidateCenters.push({ u: proj.u + dChord * uX, v: proj.v + dChord * uY });
          if (dChord > 1e-4) {
            candidateCenters.push({ u: proj.u - dChord * uX, v: proj.v - dChord * uY });
          }
        }
      }

      if (candidateCenters.length === 0) return false;

      const midClick = { u: (ptLine.u + ptCurve.u) / 2, v: (ptLine.v + ptCurve.v) / 2 };
      let bestCenter = null;
      let minD = Infinity;
      for (const C of candidateCenters) {
        const d = Math.hypot(C.u - midClick.u, C.v - midClick.v);
        if (d < minD) { minD = d; bestCenter = C; }
      }
      if (!bestCenter) return false;
      const Cf = bestCenter;

      const TLine = projectPointOnLine(Cf, p1, p2);
      const dToC = Math.hypot(Cf.u - curveElem.cx, Cf.v - curveElem.cy);
      if (dToC < 1e-4) return false;
      const TCurve = {
        u: curveElem.cx + Rc * (Cf.u - curveElem.cx) / dToC,
        v: curveElem.cy + Rc * (Cf.v - curveElem.cy) / dToC
      };

      const arcObj = this.makeCCWArc(Cf.u, Cf.v, R, TLine, TCurve, 'visible');
      this.elements.push(arcObj);

      const dP1 = Math.hypot(p1.u - TLine.u, p1.v - TLine.v);
      const dP2 = Math.hypot(p2.u - TLine.u, p2.v - TLine.v);
      if (dP1 < dP2) lineElem.p1 = TLine; else lineElem.p2 = TLine;

      // Tự động cắt bỏ phần sừng thừa của Cung tròn (Trim excess horn of arc)
      if (curveElem.type === 'arc') {
        const aT = this.normAngle(Math.atan2(TCurve.v - curveElem.cy, TCurve.u - curveElem.cx));
        const pStart = {
          u: curveElem.cx + curveElem.r * Math.cos(curveElem.startAngle),
          v: curveElem.cy + curveElem.r * Math.sin(curveElem.startAngle)
        };
        const pEnd = {
          u: curveElem.cx + curveElem.r * Math.cos(curveElem.endAngle),
          v: curveElem.cy + curveElem.r * Math.sin(curveElem.endAngle)
        };
        const dStart = Math.hypot(pStart.u - TLine.u, pStart.v - TLine.v);
        const dEnd = Math.hypot(pEnd.u - TLine.u, pEnd.v - TLine.v);

        if (dStart < dEnd) {
          curveElem.startAngle = aT;
        } else {
          curveElem.endAngle = aT;
        }
      }

      return true;
    }

    // CASE 3: Arc/Circle and Arc/Circle
    if ((elemA.type === 'circle' || elemA.type === 'arc') && (elemB.type === 'circle' || elemB.type === 'arc')) {
      const R1 = elemA.r, R2 = elemB.r;
      const candidateCenters = [];
      const combos = [
        [R1 + R, R2 + R],
        [Math.abs(R1 - R), R2 + R],
        [R1 + R, Math.abs(R2 - R)],
        [Math.abs(R1 - R), Math.abs(R2 - R)]
      ];

      for (const [r1o, r2o] of combos) {
        if (r1o > 1e-4 && r2o > 1e-4) {
          const inters = this.intersectCircleCircle(
            { cx: elemA.cx, cy: elemA.cy, r: r1o },
            { cx: elemB.cx, cy: elemB.cy, r: r2o }
          );
          if (inters && inters.length > 0) {
            candidateCenters.push(...inters);
          }
        }
      }

      if (candidateCenters.length === 0) return false;

      const midClick = { u: (ptA.u + ptB.u) / 2, v: (ptA.v + ptB.v) / 2 };
      let bestCenter = null;
      let minD = Infinity;
      for (const p of candidateCenters) {
        const d = Math.hypot(p.u - midClick.u, p.v - midClick.v);
        if (d < minD) { minD = d; bestCenter = p; }
      }
      if (!bestCenter) return false;

      const Cf = bestCenter;
      const d1 = Math.hypot(Cf.u - elemA.cx, Cf.v - elemA.cy);
      const d2 = Math.hypot(Cf.u - elemB.cx, Cf.v - elemB.cy);
      if (d1 < 1e-4 || d2 < 1e-4) return false;

      const TA = { u: elemA.cx + R1 * (Cf.u - elemA.cx) / d1, v: elemA.cy + R1 * (Cf.v - elemA.cy) / d1 };
      const TB = { u: elemB.cx + R2 * (Cf.u - elemB.cx) / d2, v: elemB.cy + R2 * (Cf.v - elemB.cy) / d2 };

      const arcObj = this.makeCCWArc(Cf.u, Cf.v, R, TA, TB, 'visible');
      this.elements.push(arcObj);

      // Tự động cắt phần sừng thừa của cả 2 cung nếu là arc
      if (elemA.type === 'arc') {
        const aTA = this.normAngle(Math.atan2(TA.v - elemA.cy, TA.u - elemA.cx));
        const pStartA = { u: elemA.cx + elemA.r * Math.cos(elemA.startAngle), v: elemA.cy + elemA.r * Math.sin(elemA.startAngle) };
        const pEndA = { u: elemA.cx + elemA.r * Math.cos(elemA.endAngle), v: elemA.cy + elemA.r * Math.sin(elemA.endAngle) };
        if (Math.hypot(pStartA.u - TB.u, pStartA.v - TB.v) < Math.hypot(pEndA.u - TB.u, pEndA.v - TB.v)) {
          elemA.startAngle = aTA;
        } else {
          elemA.endAngle = aTA;
        }
      }
      if (elemB.type === 'arc') {
        const aTB = this.normAngle(Math.atan2(TB.v - elemB.cy, TB.u - elemB.cx));
        const pStartB = { u: elemB.cx + elemB.r * Math.cos(elemB.startAngle), v: elemB.cy + elemB.r * Math.sin(elemB.startAngle) };
        const pEndB = { u: elemB.cx + elemB.r * Math.cos(elemB.endAngle), v: elemB.cy + elemB.r * Math.sin(elemB.endAngle) };
        if (Math.hypot(pStartB.u - TA.u, pStartB.v - TA.v) < Math.hypot(pEndB.u - TA.u, pEndB.v - TA.v)) {
          elemB.startAngle = aTB;
        } else {
          elemB.endAngle = aTB;
        }
      }

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
      toolHint = `📐 <b>Đo Cạnh:</b> Click thẳng vào cạnh để đo ngay chiều dài cạnh`;
    } else if (this.tool === 'dim-points') {
      toolHint = (this.pendingPoints.length === 0)
        ? `🎯 <b>Đo 2 Điểm:</b> Click chọn <b>ĐIỂM THỨ 1</b>`
        : `🎯 <b>Đo 2 Điểm:</b> Click chọn <b>ĐIỂM THỨ 2</b> để đo khoảng cách giữa 2 điểm`;
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
    const w = this.currentViewW || this.bounds.w;
    const h = this.currentViewH || this.bounds.h;
    const s = this.scale;

    // 1. Nền không gian vẽ CAD đậm chất kỹ thuật
    ctx.fillStyle = '#080c15';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // 2. TÍNH TOÁN BƯỚC HIỂN THỊ THÍCH ỨNG (ADAPTIVE LOD & ZOOM OUT BỚT SỐ)
    // Đảm bảo khoảng cách giữa các số hiển thị luôn từ 85px đến 160px, không bị dày đặc khi zoom out
    const minPixelSpacing = 85;
    const targetUnitStep = minPixelSpacing / s;
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(1e-4, targetUnitStep))));
    const fraction = targetUnitStep / power;
    let labelStep = 1;
    if (fraction <= 1.4) labelStep = 1 * power;
    else if (fraction <= 3.2) labelStep = 2 * power;
    else if (fraction <= 7.0) labelStep = 5 * power;
    else labelStep = 10 * power;
    labelStep = Math.max(1, Math.round(labelStep));

    // Bước lưới phụ (Subgrid step)
    const gridStep = (s < 10) ? labelStep : (s < 24 ? Math.max(1, Math.round(labelStep / 2)) : 1);

    // Phạm vi lưới hiển thị trên màn hình hiện tại
    const minU = Math.floor((-this.offsetX) / s) - 2;
    const maxU = Math.ceil((rect.width - this.offsetX) / s) + 2;
    const maxV = Math.ceil((this.offsetY) / s) + 2;
    const minV = Math.floor((this.offsetY - rect.height) / s) - 2;

    const firstGridU = Math.floor(minU / gridStep) * gridStep;
    const firstGridV = Math.floor(minV / gridStep) * gridStep;

    // Vẽ lưới phụ và lưới chính
    for (let u = firstGridU; u <= maxU; u += gridStep) {
      const isMajor = (u % labelStep === 0);
      ctx.strokeStyle = isMajor ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = isMajor ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(this.offsetX + u * s, 0);
      ctx.lineTo(this.offsetX + u * s, rect.height);
      ctx.stroke();
    }
    for (let v = firstGridV; v <= maxV; v += gridStep) {
      const isMajor = (v % labelStep === 0);
      ctx.strokeStyle = isMajor ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.025)';
      ctx.lineWidth = isMajor ? 1.2 : 0.8;
      ctx.beginPath();
      ctx.moveTo(0, this.offsetY - v * s);
      ctx.lineTo(rect.width, this.offsetY - v * s);
      ctx.stroke();
    }

    // Chấm nút lưới bắt dính (chỉ vẽ khi zoom gần để tối ưu tốc độ và không làm mờ hình)
    if (s >= 26) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
      for (let u = minU; u <= maxU; u++) {
        for (let v = minV; v <= maxV; v++) {
          ctx.beginPath();
          ctx.arc(this.offsetX + u * s, this.offsetY - v * s, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (s >= 8) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.4)';
      for (let u = firstGridU; u <= maxU; u += labelStep) {
        for (let v = firstGridV; v <= maxV; v += labelStep) {
          ctx.beginPath();
          ctx.arc(this.offsetX + u * s, this.offsetY - v * s, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 3. KHUNG BẢN VẼ / KHUNG PHÔI (THEO CHẾ ĐỘ FRAME MODE: TẮT / PHÔI 3D / KHUNG A4 ISO)
    if (this.frameMode === 'block') {
      const boxX = this.offsetX;
      const boxY = this.offsetY - h * s;
      const boxW = w * s;
      const boxH = h * s;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.setLineDash([]);

      // Nhãn khung phôi
      ctx.font = '10px monospace';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.textAlign = 'left';
      ctx.fillText(`Phôi 3D: ${w} × ${h}`, boxX + 6, boxY + 14);
    } else if (this.frameMode === 'a4') {
      // Khung khổ giấy kỹ thuật A4 tiêu chuẩn (Khổ ngang 297 x 210 mm)
      const a4W = 297;
      const a4H = 210;
      const x0 = this.offsetX;
      const y0 = this.offsetY - a4H * s;
      const wPx = a4W * s;
      const hPx = a4H * s;

      // Nét viền mép giấy A4
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(x0, y0, wPx, hPx);

      // Khung bản vẽ kỹ thuật (Khung trong: Trái 20mm, Phải/Trên/Dưới 10mm)
      const mLeft = 20 * s;
      const mOther = 10 * s;
      const borderX = x0 + mLeft;
      const borderY = y0 + mOther;
      const borderW = wPx - mLeft - mOther;
      const borderH = hPx - mOther * 2;

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.0;
      ctx.strokeRect(borderX, borderY, borderW, borderH);

      // Khung tên góc dưới bên phải (Title block: 140mm x 32mm)
      const tbW = 140 * s;
      const tbH = 32 * s;
      const tbX = borderX + borderW - tbW;
      const tbY = borderY + borderH - tbH;

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tbX, tbY, tbW, tbH);

      if (s >= 0.7) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(tbX, tbY, tbW, tbH);
        ctx.strokeRect(tbX, tbY, tbW, tbH);

        ctx.fillStyle = '#38bdf8';
        ctx.font = `bold ${Math.max(10, Math.round(3.5 * s))}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('BẢN VẼ KỸ THUẬT (ISO 129)', tbX + 8 * s, tbY + 6 * s);

        ctx.fillStyle = '#94a3b8';
        ctx.font = `${Math.max(9, Math.round(2.8 * s))}px sans-serif`;
        ctx.fillText('Khổ A4: 297 × 210 mm  |  Tỉ lệ: 1:1', tbX + 8 * s, tbY + 18 * s);
      }
    }

    // 4. TRỤC TỌA ĐỘ X VÀ Y KÉO DÀI VÔ TẬN VỚI MŨI TÊN CHỈ HƯỚNG
    // Trục X (Màu xanh cyan sáng, nét dày 3.2px)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(0, this.offsetY);
    ctx.lineTo(rect.width, this.offsetY);
    ctx.stroke();

    // Mũi tên trục X ở mép phải màn hình
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(rect.width - 24, this.offsetY - 7);
    ctx.lineTo(rect.width - 8, this.offsetY);
    ctx.lineTo(rect.width - 24, this.offsetY + 7);
    ctx.fill();
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('+X', rect.width - 28, this.offsetY - 10);

    // Trục Y (Màu xanh cyan sáng, nét dày 3.2px)
    ctx.beginPath();
    ctx.moveTo(this.offsetX, 0);
    ctx.lineTo(this.offsetX, rect.height);
    ctx.stroke();

    // Mũi tên trục Y ở mép trên màn hình
    ctx.beginPath();
    ctx.moveTo(this.offsetX - 7, 24);
    ctx.lineTo(this.offsetX, 8);
    ctx.lineTo(this.offsetX + 7, 24);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillText('+Y', this.offsetX + 12, 22);

    // Điểm gốc tọa độ O(0, 0)
    ctx.beginPath();
    ctx.arc(this.offsetX, this.offsetY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f43f5e';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Nhãn O(0, 0) dạng badge bo góc với nền tối mờ chống đè chữ
    const oLabel = 'O (0, 0)';
    ctx.font = 'bold 11px monospace';
    const oMetrics = ctx.measureText(oLabel);
    const badgeW = oMetrics.width + 12;
    const badgeH = 20;
    const badgeX = this.offsetX - badgeW - 8;
    const badgeY = this.offsetY + 8;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f43f5e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(oLabel, badgeX + badgeW / 2, badgeY + badgeH / 2);

    // 5. CÁC VẠCH CHIA & SỐ ĐO TRỤC TỌA ĐỘ (TỰ ĐỘNG ẨN BỚT KHI ZOOM OUT THEO labelStep)
    // Vạch và số trên trục X
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Vị trí hiển thị số trục X (nếu trục X nằm ngoài màn hình thì số bám mép màn hình)
    const textYForXAxis = Math.max(18, Math.min(rect.height - 24, this.offsetY + 8));

    const firstLabelU = Math.floor(minU / labelStep) * labelStep;
    for (let u = firstLabelU; u <= maxU; u += labelStep) {
      if (u === 0) continue;
      const x = this.offsetX + u * s;

      // Vạch chia chính (Major Tick)
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(x, this.offsetY - 6);
      ctx.lineTo(x, this.offsetY + 6);
      ctx.stroke();

      // Bỏ qua hiển thị số nếu vị trí quá gần gốc tọa độ O để tránh đè chữ badge O(0,0)
      const safeOriginDistX = (x < this.offsetX) ? 80 : 48;
      if (Math.abs(x - this.offsetX) < safeOriginDistX) continue;

      // Số hiển thị
      ctx.fillText(u, x, textYForXAxis);
    }

    // Vạch và số trên trục Y
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const textXForYAxis = Math.max(38, Math.min(rect.width - 15, this.offsetX - 10));

    const firstLabelV = Math.floor(minV / labelStep) * labelStep;
    for (let v = firstLabelV; v <= maxV; v += labelStep) {
      if (v === 0) continue;
      const y = this.offsetY - v * s;

      // Vạch chia chính (Major Tick)
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(this.offsetX - 6, y);
      ctx.lineTo(this.offsetX + 6, y);
      ctx.stroke();

      // Bỏ qua hiển thị số nếu vị trí quá gần gốc tọa độ O để tránh đè chữ
      const safeOriginDistY = (y > this.offsetY) ? 55 : 36;
      if (Math.abs(y - this.offsetY) < safeOriginDistY) continue;

      // Số hiển thị
      ctx.fillText(v, textXForYAxis, y);
    }

    // 5. VẼ CÁC ĐỐI TƯỢNG HÌNH HỌC (LINES, ARCS, CIRCLES, DIMS)
    const drawnDimKeys = new Set();
    for (const elem of this.elements) {
      if (elem.type === 'line') {
        const x1 = this.offsetX + elem.p1.u * s;
        const y1 = this.offsetY - elem.p1.v * s;
        const x2 = this.offsetX + elem.p2.u * s;
        const y2 = this.offsetY - elem.p2.v * s;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);

        if (elem.style === 'guide') {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'; // Nét gióng dóng liên kết các hình chiếu
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 4]);
        } else if (elem.style === 'hidden') {
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
        const k1 = `${elem.p1.u.toFixed(2)},${elem.p1.v.toFixed(2)}-${elem.p2.u.toFixed(2)},${elem.p2.v.toFixed(2)}`;
        const k2 = `${elem.p2.u.toFixed(2)},${elem.p2.v.toFixed(2)}-${elem.p1.u.toFixed(2)},${elem.p1.v.toFixed(2)}`;
        if (drawnDimKeys.has(k1) || drawnDimKeys.has(k2)) {
          continue;
        }
        drawnDimKeys.add(k1);

        const isHovered = (this.hoveredDim === elem || this.highlightedDim === elem);
        const strokeColor = isHovered ? (this.tool === 'erase' ? '#ef4444' : '#f59e0b') : '#38bdf8';
        const textColor = isHovered ? (this.tool === 'erase' ? '#f87171' : '#fbbf24') : '#38bdf8';
        const boxBg = isHovered ? (this.tool === 'erase' ? 'rgba(239, 68, 68, 0.28)' : 'rgba(245, 158, 11, 0.25)') : 'rgba(8, 12, 21, 0.94)';
        const boxBorder = isHovered ? (this.tool === 'erase' ? '#ef4444' : '#f59e0b') : 'rgba(56, 189, 248, 0.5)';

        // Vẽ kích thước (Dimension line)
        const x1 = this.offsetX + elem.p1.u * s;
        const y1 = this.offsetY - elem.p1.v * s;
        const x2 = this.offsetX + elem.p2.u * s;
        const y2 = this.offsetY - elem.p2.v * s;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isHovered ? 2.4 : 1.4;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Điểm tròn đánh dấu 2 đầu
        ctx.beginPath();
        ctx.arc(x1, y1, isHovered ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.arc(x2, y2, isHovered ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();

        if (len > 0.001) {
          // Tính pháp tuyến vuông góc với đường kích thước
          let nx = -dy / len;
          let ny = dx / len;

          // Chuẩn hóa hướng pháp tuyến để số đo luôn ở vị trí chuẩn kỹ thuật:
          // Nếu đường chủ yếu nằm ngang (|dx| >= |dy|): chữ ở phía trên đường (ny < 0)
          // Nếu đường chủ yếu thẳng đứng (|dx| < |dy|): chữ ở bên trái đường (nx < 0)
          if (Math.abs(dx) >= Math.abs(dy)) {
            if (ny > 0) { nx = -nx; ny = -ny; }
          } else {
            if (nx > 0) { nx = -nx; ny = -ny; }
          }

          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const offsetDist = 16;
          const textX = midX + nx * offsetDist;
          const textY = midY + ny * offsetDist;

          const text = `${elem.dist}`;
          ctx.font = isHovered ? 'bold 13px monospace' : 'bold 12px monospace';
          const textMetrics = ctx.measureText(text);
          const textW = textMetrics.width;
          const textH = 14;
          const padX = 5;
          const padY = 2;

          // Hộp nền tối bảo vệ số đo (Knockout/Background Mask) - không để đường thẳng cắt xuyên qua chữ số
          ctx.save();
          ctx.fillStyle = boxBg;
          ctx.fillRect(textX - textW / 2 - padX, textY - textH / 2 - padY, textW + padX * 2, textH + padY * 2);

          // Khung viền mỏng quanh số đo
          ctx.strokeStyle = boxBorder;
          ctx.lineWidth = isHovered ? 1.6 : 0.8;
          ctx.strokeRect(textX - textW / 2 - padX, textY - textH / 2 - padY, textW + padX * 2, textH + padY * 2);

          // Vẽ chữ số đo
          ctx.fillStyle = textColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, textX, textY);
          ctx.restore();
        }

      } else if (elem.type === 'dim-radial') {
        const isHovered = (this.hoveredDim === elem || this.highlightedDim === elem);
        const strokeColor = isHovered ? (this.tool === 'erase' ? '#ef4444' : '#f59e0b') : '#38bdf8';
        const textColor = isHovered ? (this.tool === 'erase' ? '#ef4444' : '#fbbf24') : '#38bdf8';

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

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = isHovered ? 2.4 : 1.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(lx, ly);
        ctx.lineTo(doglegX, doglegY);
        ctx.stroke();

        const arrLen = 8;
        const backAngle = Math.atan2(cy - py, cx - px);
        ctx.fillStyle = strokeColor;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + arrLen * Math.cos(backAngle - 0.35), py + arrLen * Math.sin(backAngle - 0.35));
        ctx.lineTo(px + arrLen * Math.cos(backAngle + 0.35), py + arrLen * Math.sin(backAngle + 0.35));
        ctx.fill();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(cx - 5, cy);
        ctx.lineTo(cx + 5, cy);
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx, cy + 5);
        ctx.stroke();

        const labelText = elem.isDiameter ? `Ø ${elem.dist}` : `R ${elem.dist}`;
        ctx.fillStyle = textColor;
        ctx.font = isHovered ? 'bold 13px monospace' : 'bold 12px monospace';
        ctx.textAlign = (cosA >= 0) ? 'left' : 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(labelText, doglegX + (cosA >= 0 ? 4 : -4), doglegY - 2);
      } else if (elem.type === 'label') {
        const x = this.offsetX + elem.p.u * s;
        const y = this.offsetY - elem.p.v * s;
        ctx.save();
        ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const color = elem.color || '#38bdf8';
        const textWidth = ctx.measureText(elem.text).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(x - textWidth / 2 - 8, y - 12, textWidth + 16, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(elem.text, x, y);
        ctx.restore();

      } else if (elem.type === 'dim-angle') {
        const x = this.offsetX + elem.p.u * s;
        const y = this.offsetY - elem.p.v * s;
        ctx.save();
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const badge = `∠ ${elem.angle}°`;
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(x - 26, y - 12, 52, 24, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(badge, x, y);
        ctx.restore();
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

      const x1 = this.offsetX + p1.u * s;
      const y1 = this.offsetY - p1.v * s;
      const x2 = this.offsetX + p2.u * s;
      const y2 = this.offsetY - p2.v * s;

      // Điểm mốc đã click
      ctx.beginPath();
      ctx.arc(x1, y1, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#f43f5e';
      ctx.fill();

      if (this.tool === 'line-visible' || this.tool === 'line-hidden' || this.tool === 'dim' || this.tool === 'dim-points') {
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

    // Highlight xem trước khi rê chuột vào cạnh ở công cụ Đo Kích Thước (DIM)
    if (this.tool === 'dim' && this.pendingPoints.length === 0 && this.hoverSnap) {
      const clickPoint = { u: this.hoverSnap.u, v: this.hoverSnap.v };
      let bestLine = null;
      let minLineDist = Math.max(0.35, 18 / s);

      for (const elem of this.elements) {
        if (elem.type === 'line') {
          const dLine = this.pointToSegmentDistance(clickPoint, elem.p1, elem.p2);
          if (dLine < minLineDist) {
            minLineDist = dLine;
            bestLine = elem;
          }
        }
      }

      if (bestLine) {
        const x1 = this.offsetX + bestLine.p1.u * s;
        const y1 = this.offsetY - bestLine.p1.v * s;
        const x2 = this.offsetX + bestLine.p2.u * s;
        const y2 = this.offsetY - bestLine.p2.v * s;
        const len = Math.hypot(bestLine.p2.u - bestLine.p1.u, bestLine.p2.v - bestLine.p1.v).toFixed(2);

        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.roundRect(midX - 28, midY - 26, 56, 20, 4);
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`L = ${len}`, midX, midY - 16);
        ctx.restore();
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

    // 6. Khung bao vật thể phôi (Bounding block) nét mảnh (chỉ vẽ khi bật chế độ khung phôi)
    if (this.frameMode === 'block') {
      const boxX1 = toCanvasX(0);
      const boxY1 = toCanvasY(this.bounds.h);
      const boxW = this.bounds.w * scaleExport;
      const boxH = this.bounds.h * scaleExport;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(boxX1, boxY1, boxW, boxH);
      ctx.setLineDash([]);
    }

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

        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy);

        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Điểm tròn 2 đầu
        ctx.beginPath();
        ctx.arc(x1, y1, 5, 0, Math.PI * 2);
        ctx.arc(x2, y2, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.fill();

        if (len > 0.001) {
          let nx = -dy / len;
          let ny = dx / len;
          if (Math.abs(dx) >= Math.abs(dy)) {
            if (ny > 0) { nx = -nx; ny = -ny; }
          } else {
            if (nx > 0) { nx = -nx; ny = -ny; }
          }

          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const offsetDist = 18;
          const textX = midX + nx * offsetDist;
          const textY = midY + ny * offsetDist;

          const text = `${elem.dist}`;
          ctx.font = 'bold 20px monospace';
          const textMetrics = ctx.measureText(text);
          const textW = textMetrics.width;
          const textH = 22;
          const padX = 8;
          const padY = 4;

          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(textX - textW / 2 - padX, textY - textH / 2 - padY, textW + padX * 2, textH + padY * 2);
          ctx.strokeStyle = 'rgba(2, 132, 199, 0.4)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(textX - textW / 2 - padX, textY - textH / 2 - padY, textW + padX * 2, textH + padY * 2);

          ctx.fillStyle = '#0284c7';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, textX, textY);
          ctx.restore();
        }

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
