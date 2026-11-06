import * as THREE from 'three';

export class InteractivePicker {
  constructor(scene, camera, renderer, controls, cadEngine, preview, callbacks) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.cad = cadEngine;
    this.preview = preview;
    this.callbacks = callbacks;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.currentBrush = null;
    this.bounds = { w: 6, h: 4, d: 4 };

    // Default mode: 'view' (Chỉ Xem)
    this.mode = 'view';

    // Options
    this.slantCutAbove = true;
    this.slantPlane = 'XY';
    this.cornerDelta = { dx: 1, dy: -1, dz: -1 };

    // Tuỳ chỉnh độ sâu trực tiếp tại HUD
    this.customDepth = 4;
    this.isFullDepth = true;

    // Manual override cho đỉnh nhọn rãnh V (0, 1, 2 hoặc -1 là auto)
    this.vApexOverride = -1;

    // Index góc hộp cho vát góc 3 điểm
    this.cornerCandidateIndex = 0;

    // Selected points in 3D: [ { x, y, z }, ... ]
    this.selectedPoints = [];

    this.pointerDownPos = { x: 0, y: 0 };
    this.isPointerDown = false;

    // 3D groups for markers
    this.pickerGroup = new THREE.Group();
    this.pickerGroup.renderOrder = 999;
    this.scene.add(this.pickerGroup);

    // Chấm nút lưới bề mặt
    this.gridNodesGroup = new THREE.Group();
    this.gridNodesGroup.visible = false;
    this.scene.add(this.gridNodesGroup);

    // Hover snap marker
    this.initHoverMarker();

    // DOM HUD elements
    this.hudElement = document.getElementById('interactive-hud');
    this.tooltipElement = document.getElementById('picker-tooltip');

    this.bindEvents();
    this.updateCursor();
    this.updateHUD();
  }

  initHoverMarker() {
    const geom = new THREE.SphereGeometry(0.18, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });
    this.hoverMarker = new THREE.Mesh(geom, mat);
    this.hoverMarker.renderOrder = 1000;
    this.hoverMarker.visible = false;
    this.scene.add(this.hoverMarker);

    const ringGeom = new THREE.RingGeometry(0.24, 0.36, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      depthTest: false
    });
    this.hoverRing = new THREE.Mesh(ringGeom, ringMat);
    this.hoverRing.renderOrder = 1001;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
  }

  updateModel(brush, w, h, d) {
    this.currentBrush = brush;
    this.bounds = { w, h, d };
    this.customDepth = d;
    this.clearSelection();
    this.rebuildSurfaceGridNodes();
  }

  // TẠO CÁC NÚT LƯỚI BỀ MẶT VÀ GÁN PHÁP TUYẾN MẶT ĐỂ QUẢN LÝ TẦM NHÌN
  rebuildSurfaceGridNodes() {
    while (this.gridNodesGroup.children.length > 0) {
      const obj = this.gridNodesGroup.children[0];
      this.gridNodesGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    const { w, h, d } = this.bounds;
    const nodeGeom = new THREE.SphereGeometry(0.08, 10, 10);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.55
    });

    const pts = new Map();
    const addPt = (x, y, z, nx, ny, nz) => {
      const k = `${x},${y},${z}`;
      if (!pts.has(k)) {
        pts.set(k, { pos: new THREE.Vector3(x, y, z), normals: [] });
      }
      pts.get(k).normals.push(new THREE.Vector3(nx, ny, nz));
    };

    // Tạo các nút trên 6 mặt ngoài
    for (let x = 0; x <= w; x++) {
      for (let y = 0; y <= h; y++) {
        addPt(x, y, d, 0, 0, 1);  // Trước
        addPt(x, y, 0, 0, 0, -1); // Sau
      }
    }
    for (let x = 0; x <= w; x++) {
      for (let z = 0; z <= d; z++) {
        addPt(x, h, z, 0, 1, 0);  // Trên
        addPt(x, 0, z, 0, -1, 0); // Dưới
      }
    }
    for (let z = 0; z <= d; z++) {
      for (let y = 0; y <= h; y++) {
        addPt(w, y, z, 1, 0, 0);  // Phải
        addPt(0, y, z, -1, 0, 0); // Trái
      }
    }

    pts.forEach((item) => {
      const mesh = new THREE.Mesh(nodeGeom, nodeMat);
      mesh.position.copy(item.pos);
      mesh.userData = { normals: item.normals };
      this.gridNodesGroup.add(mesh);
    });

    this.gridNodesGroup.visible = (this.mode !== 'view');
    this.updateVisibleGridNodes();
  }

  // CẬP NHẬT CHỈ HIỆN CÁC NÚT LƯỚI TRÊN CÁC MẶT ĐANG HƯỚNG VỀ PHÍA CAMERA
  updateVisibleGridNodes() {
    if (this.mode === 'view' || !this.gridNodesGroup.visible) return;

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    for (const mesh of this.gridNodesGroup.children) {
      if (!mesh.userData || !mesh.userData.normals) continue;
      // Nếu có ít nhất 1 pháp tuyến của điểm này hướng về phía camera
      let isFacingCam = false;
      for (const n of mesh.userData.normals) {
        if (n.dot(camDir) < -0.05) {
          isFacingCam = true;
          break;
        }
      }
      mesh.visible = isFacingCam;
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.clearSelection();
    this.updateCursor();

    this.gridNodesGroup.visible = (this.mode !== 'view');
    if (this.mode !== 'view') {
      this.updateVisibleGridNodes();
    }

    if (this.mode === 'view') {
      this.hoverMarker.visible = false;
      this.hoverRing.visible = false;
      if (this.tooltipElement) this.tooltipElement.style.display = 'none';
    }

    this.updateHUD();
    if (this.callbacks.onModeChange) {
      this.callbacks.onModeChange(mode);
    }
  }

  updateCursor() {
    const dom = this.renderer.domElement;
    if (this.mode === 'view') {
      dom.style.cursor = 'grab';
    } else {
      dom.style.cursor = 'crosshair';
    }
  }

  clearSelection() {
    this.selectedPoints = [];
    this.vApexOverride = -1;
    this.cornerCandidateIndex = 0;
    while (this.pickerGroup.children.length > 0) {
      const obj = this.pickerGroup.children[0];
      this.pickerGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }
    this.preview.clear();
    this.updateHUD();
  }

  bindEvents() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      this.isPointerDown = true;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      if (this.mode === 'view') {
        dom.style.cursor = 'grabbing';
      }
    });

    dom.addEventListener('pointermove', (e) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (!this.isPointerDown && this.mode !== 'view') {
        this.handleHover(e);
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.isPointerDown) return;
      this.isPointerDown = false;
      this.updateCursor();

      if (this.mode === 'view') return;

      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (dist > 6) return;

      this.handleClick(e);
    });

    // Khi người dùng xoay hoặc phóng to camera, cập nhật lại các nút lưới nhìn thấy
    if (this.controls) {
      this.controls.addEventListener('change', () => {
        this.updateVisibleGridNodes();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'Enter' || e.code === 'Space') {
        if (this.mode !== 'view') {
          e.preventDefault();
          this.executeCurrentCut();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.clearSelection();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.selectedPoints.length > 0 && (this.mode === 'poly' || this.mode === 'slant')) {
          e.preventDefault();
          this.removeLastPoint();
        }
      } else if (e.key === 'Tab' || e.key.toLowerCase() === 'f') {
        if (this.mode === 'poly') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>CÁC ĐIỂM LIÊN TIẾP</b> trên khối (3, 4, 5, 6... điểm) để tự kết nối thành vùng kín</span>
          </div>
        `;
      } else if (count < 3) {
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Đã chọn ${count} điểm</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ ${count + 1}</b> để tạo thành hình kín...</span>
            <button class="hud-btn-action" id="hud-remove-point">↩️ Xóa điểm</button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      } else {
        html = `
          <div class="hud-actions">
            <div class="hud-coords">⬡ Đa giác / Khối kín (${count} điểm tự nối)</div>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT PHẦN TRONG ĐÓ (Enter)
            </button>
            <button class="hud-btn-action" id="hud-remove-point" title="Xóa điểm gần nhất (Backspace)">
              ↩️ Xóa điểm cuối
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      }

    } else if (this.mode === 'slant') {
          e.preventDefault();
          this.toggleSlantDirection();
        } else if (this.mode === 'vgroove') {
          e.preventDefault();
          this.cycleVApex();
        } else if (this.mode === 'corner') {
          e.preventDefault();
          this.cycleCornerO();
        }
      }
    });
  }

  // CHỈ BẮT DÍNH NÚT TRÊN MẶT ĐANG HƯỚNG VỀ PHÍA CAMERA (VÀ KHÔNG BỊ KHỐI CHE KHUẤT)
  findSnapPoint() {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    let hitPoint = null;
    let hitNormal = null;

    if (this.currentBrush) {
      const intersects = this.raycaster.intersectObject(this.currentBrush, false);
      if (intersects.length > 0) {
        const hit = intersects[0];
        // Tính pháp tuyến mặt phẳng va chạm ngoài thế giới thực
        const norm = hit.face.normal.clone().transformDirection(this.currentBrush.matrixWorld).normalize();
        const viewDir = new THREE.Vector3().subVectors(this.camera.position, hit.point).normalize();

        // Chỉ chấp nhận nếu mặt phẳng đang hướng về phía camera
        if (norm.dot(viewDir) > 0.05) {
          hitPoint = hit.point;
          hitNormal = norm;
        }
      }
    }

    if (!hitPoint) return null;

    let sx = Math.round(hitPoint.x);
    let sy = Math.round(hitPoint.y);
    let sz = Math.round(hitPoint.z);

    // Khóa tọa độ theo đúng mặt phẳng va chạm
    if (Math.abs(hitNormal.z) > 0.8) {
      sz = Math.round(hitPoint.z);
    } else if (Math.abs(hitNormal.x) > 0.8) {
      sx = Math.round(hitPoint.x);
    } else if (Math.abs(hitNormal.y) > 0.8) {
      sy = Math.round(hitPoint.y);
    }

    sx = Math.max(0, Math.min(this.bounds.w, sx));
    sy = Math.max(0, Math.min(this.bounds.h, sy));
    sz = Math.max(0, Math.min(this.bounds.d, sz));

    const snapCandidate = new THREE.Vector3(sx, sy, sz);

    // Kiểm tra xem candidate có bị che khuất bởi mặt trước của khối không (chống bắt xuyên mặt sau)
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const testOrigin = snapCandidate.clone().addScaledVector(camDir, -60);
    const occRay = new THREE.Raycaster(testOrigin, camDir, 0.1, 120);
    const occHits = occRay.intersectObject(this.currentBrush, false);
    if (occHits.length > 0) {
      const firstHit = occHits[0];
      const distToCandidate = testOrigin.distanceTo(snapCandidate);
      if (firstHit.distance < distToCandidate - 0.25) {
        // Điểm này bị khuất phía sau một gờ khối khác
        return null;
      }
    }

    return snapCandidate;
  }

  handleHover(e) {
    if (this.mode === 'view') return;

    const snap = this.findSnapPoint();
    if (!snap) {
      this.hoverMarker.visible = false;
      this.hoverRing.visible = false;
      if (this.tooltipElement) this.tooltipElement.style.display = 'none';
      return;
    }

    this.hoverMarker.position.copy(snap);
    this.hoverMarker.visible = true;

    this.hoverRing.position.copy(snap);
    this.hoverRing.quaternion.copy(this.camera.quaternion);
    this.hoverRing.visible = true;

    if (this.tooltipElement) {
      this.tooltipElement.style.display = 'block';
      this.tooltipElement.style.left = `${e.clientX + 14}px`;
      this.tooltipElement.style.top = `${e.clientY - 28}px`;
      this.tooltipElement.innerHTML = `📍 <b>(X: ${snap.x}, Y: ${snap.y}, Z: ${snap.z})</b>`;
    }
  }

  handleClick(e) {
    if (this.mode === 'view') return;

    const snap = this.findSnapPoint();
    if (!snap) return;

    const pt = { x: snap.x, y: snap.y, z: snap.z };

    if (this.mode === 'corner') {
      this.cornerCandidateIndex = 0;
      if (this.selectedPoints.length >= 3) {
        this.selectedPoints = [pt];
      } else {
        const isDuplicate = this.selectedPoints.some(p => p.x === pt.x && p.y === pt.y && p.z === pt.z);
        if (isDuplicate) return;
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 3) {
        this.updatePreviewForCorner();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'poly') {
      const isDuplicate = this.selectedPoints.some(p => p.x === pt.x && p.y === pt.y && p.z === pt.z);
      if (isDuplicate) return;
      this.selectedPoints.push(pt);
      this.renderPointMarkers();
      if (this.selectedPoints.length >= 3) {
        this.updatePreviewForPoly();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'slant') {
      if (this.selectedPoints.length >= 3) {
        this.selectedPoints = [pt];
      } else {
        const isDuplicate = this.selectedPoints.some(p => p.x === pt.x && p.y === pt.y && p.z === pt.z);
        if (isDuplicate) return;
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 2) {
        this.updatePreviewForSlant();
      } else if (this.selectedPoints.length === 3) {
        this.updatePreviewForPlane3Points();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'box') {
      if (this.selectedPoints.length >= 2) {
        this.selectedPoints = [pt];
      } else {
        if (this.selectedPoints.length === 1) {
          const p1 = this.selectedPoints[0];
          if (p1.x === pt.x && p1.y === pt.y && p1.z === pt.z) return;
        }
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 2) {
        this.updatePreviewForBox();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'vgroove') {
      this.vApexOverride = -1;
      if (this.selectedPoints.length >= 3) {
        this.selectedPoints = [pt];
      } else {
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 3) {
        this.updatePreviewForVGroove();
      } else {
        this.preview.clear();
      }
    }

    this.updateHUD();
    if (this.callbacks.onPointsChanged) {
      this.callbacks.onPointsChanged(this.mode, this.selectedPoints);
    }
  }

  // TỰ ĐỘNG PHÂN LOẠI CHÍNH XÁC APEX VÀ 2 BASE CỦA RÃNH V THEO GRID
  getVGroovePoints() {
    const pts = this.selectedPoints;
    if (pts.length < 3) return null;

    if (this.vApexOverride >= 0 && this.vApexOverride < 3) {
      const aIdx = this.vApexOverride;
      return {
        apex: pts[aIdx],
        base1: pts[(aIdx + 1) % 3],
        base2: pts[(aIdx + 2) % 3]
      };
    }

    // 1. Phân loại theo cạnh mép chuẩn: 2 chân rãnh luôn có chung toạ độ mép biên
    for (let i = 0; i < 3; i++) {
      const pA = pts[i];
      const pB = pts[(i + 1) % 3];
      const pC = pts[(i + 2) % 3];
      if (Math.abs(pB.y - pC.y) < 0.001 && Math.abs(pA.y - pB.y) > 0.001) return { apex: pA, base1: pB, base2: pC };
      if (Math.abs(pB.x - pC.x) < 0.001 && Math.abs(pA.x - pB.x) > 0.001) return { apex: pA, base1: pB, base2: pC };
      if (Math.abs(pB.z - pC.z) < 0.001 && Math.abs(pA.z - pB.z) > 0.001) return { apex: pA, base1: pB, base2: pC };
    }

    // 2. Phân loại theo tính chất đối xứng tam giác cân
    const d01 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y, pts[0].z - pts[1].z);
    const d12 = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y, pts[1].z - pts[2].z);
    const d20 = Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y, pts[2].z - pts[0].z);
    if (Math.abs(d01 - d20) < 0.001) return { apex: pts[0], base1: pts[1], base2: pts[2] };
    if (Math.abs(d01 - d12) < 0.001) return { apex: pts[1], base1: pts[0], base2: pts[2] };
    if (Math.abs(d12 - d20) < 0.001) return { apex: pts[2], base1: pts[0], base2: pts[1] };

    return { apex: pts[0], base1: pts[1], base2: pts[2] };
  }

  cycleVApex() {
    if (this.selectedPoints.length < 3) return;
    const currentApex = this.getVGroovePoints().apex;
    const currentIdx = this.selectedPoints.indexOf(currentApex);
    this.vApexOverride = (currentIdx + 1) % 3;
    this.renderPointMarkers();
    this.updatePreviewForVGroove();
    this.updateHUD();
  }

  autoComputeCornerDeltas(corner) {
    const signX = (corner.x >= this.bounds.w / 2) ? -1 : 1;
    const signY = (corner.y >= this.bounds.h / 2) ? -1 : 1;
    const signZ = (corner.z >= this.bounds.d / 2) ? -1 : 1;

    const stepX = Math.min(1, this.bounds.w);
    const stepY = Math.min(1, this.bounds.h);
    const stepZ = Math.min(1, this.bounds.d);

    this.cornerDelta = {
      dx: signX * stepX,
      dy: signY * stepY,
      dz: signZ * stepZ
    };
  }

  renderPointMarkers() {
    while (this.pickerGroup.children.length > 0) {
      const obj = this.pickerGroup.children[0];
      this.pickerGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    const colors = [0x10b981, 0x38bdf8, 0xf59e0b]; // 🟢 1, 🔵 2, 🟡 3
    const pts = this.selectedPoints;

    pts.forEach((pt, index) => {
      const color = (this.mode === 'corner') ? 0xf59e0b : colors[index % colors.length];

      const sphereGeom = new THREE.SphereGeometry(0.22, 16, 16);
      const sphereMat = new THREE.MeshBasicMaterial({ color: color, depthTest: false });
      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      sphere.position.set(pt.x, pt.y, pt.z);
      sphere.renderOrder = 1002;
      this.pickerGroup.add(sphere);

      const haloGeom = new THREE.SphereGeometry(0.34, 12, 12);
      const haloMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.4,
        wireframe: true,
        depthTest: false
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.position.set(pt.x, pt.y, pt.z);
      halo.renderOrder = 1003;
      this.pickerGroup.add(halo);
    });

    if (pts.length === 2 && this.mode === 'slant') {
      const p1 = new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z);
      const p2 = new THREE.Vector3(pts[1].x, pts[1].y, pts[1].z);
      const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        linewidth: 3,
        depthTest: false
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.renderOrder = 1004;
      this.pickerGroup.add(line);
    } else if ((pts.length >= 3 && this.mode === 'poly') || (pts.length === 3 && (this.mode === 'slant' || this.mode === 'corner'))) {
      const loopPts = pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
      loopPts.push(new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z)); // Closed loop
      const lineGeom = new THREE.BufferGeometry().setFromPoints(loopPts);
      const lineMat = new THREE.LineBasicMaterial({
        color: (this.mode === 'corner') ? 0xf59e0b : 0x38bdf8,
        linewidth: 3,
        depthTest: false
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.renderOrder = 1004;
      this.pickerGroup.add(line);
    }
  }

  getCornerParams() {
    if (this.selectedPoints.length < 3) return null;
    const p1 = this.selectedPoints[0];
    const p2 = this.selectedPoints[1];
    const p3 = this.selectedPoints[2];

    const candidates = this.cad.findCandidateCornersFor3Points(p1, p2, p3);
    if (!candidates || candidates.length === 0) return null;

    const corner = candidates[this.cornerCandidateIndex % candidates.length];
    return { p1, p2, p3, corner, candidates };
  }

  updatePreviewForCorner() {
    const params = this.getCornerParams();
    if (!params) return;
    this.preview.showCorner3Points(params.p1, params.p2, params.p3, params.corner);
  }

  cycleCornerO() {
    if (this.selectedPoints.length < 3) return;
    const params = this.getCornerParams();
    if (!params || params.candidates.length <= 1) return;
    this.cornerCandidateIndex = (this.cornerCandidateIndex + 1) % params.candidates.length;
    this.updatePreviewForCorner();
    this.updateHUD();
  }

  getSlantSliceParams() {
    if (this.selectedPoints.length < 2) return null;
    const p1 = this.selectedPoints[0];
    const p2 = this.selectedPoints[1];

    const slantParams = this.computeSlantParameters(p1, p2);
    let maxD = slantParams.depthMax;
    const depth = this.isFullDepth ? maxD : Math.min(this.customDepth, maxD);

    let dMin = 0, dMax = maxD;
    if (!this.isFullDepth) {
      let faceCoord = (slantParams.plane === 'XY') ? p1.z : (slantParams.plane === 'ZY') ? p1.x : p1.y;
      if (faceCoord >= maxD - 0.001) {
        dMin = maxD - depth;
        dMax = maxD;
      } else {
        dMin = 0;
        dMax = depth;
      }
    }

    return {
      plane: slantParams.plane,
      p1_2d: slantParams.p1_2d,
      p2_2d: slantParams.p2_2d,
      dMin,
      dMax,
      maxD
    };
  }

  updatePreviewForSlant() {
    const params = this.getSlantSliceParams();
    if (!params) return;

    this.slantPlane = params.plane;
    this.preview.showSlant(
      params.plane,
      params.p1_2d,
      params.p2_2d,
      params.dMin,
      params.dMax,
      this.slantCutAbove,
      this.bounds
    );
  }


  updatePreviewForPlane3Points() {
    if (this.selectedPoints.length < 3) return;
    const [p1, p2, p3] = this.selectedPoints;
    this.preview.showPlane3Points(
      p1, p2, p3,
      this.slantCutAbove,
      this.bounds,
      this.currentBrush,
      this.cad,
      this.isFullDepth
    );
  }

  updatePreviewForPoly() {
    if (this.selectedPoints.length < 3) return;
    this.preview.showMultiPointVolume(
      this.selectedPoints,
      this.customDepth,
      this.isFullDepth,
      this.bounds,
      this.currentBrush,
      this.cad
    );
  }

  getBoxSliceParams() {
    if (this.selectedPoints.length < 2) return null;
    const p1 = this.selectedPoints[0];
    const p2 = this.selectedPoints[1];

    let x1 = p1.x, x2 = p2.x;
    let y1 = p1.y, y2 = p2.y;
    let z1 = p1.z, z2 = p2.z;

    const d = this.isFullDepth ? this.bounds.d : this.customDepth;
    if (x1 === x2) x2 = (x1 === this.bounds.w) ? x1 - d : x1 + d;
    if (y1 === y2) y2 = (y1 === this.bounds.h) ? y1 - d : y1 + d;
    if (z1 === z2) z2 = (z1 === this.bounds.d) ? z1 - d : z1 + d;

    return { x1, x2, y1, y2, z1, z2 };
  }

  updatePreviewForBox() {
    const params = this.getBoxSliceParams();
    if (!params) return;
    this.preview.showBox(params.x1, params.x2, params.y1, params.y2, params.z1, params.z2, this.currentBrush, this.cad);
  }

  getVGrooveSliceParams() {
    const vPts = this.getVGroovePoints();
    if (!vPts) return null;

    const { apex, base1, base2 } = vPts;

    let plane = 'XY';
    let maxD = this.bounds.d;
    let a2d = { u: apex.x, v: apex.y };
    let b1_2d = { u: base1.x, v: base1.y };
    let b2_2d = { u: base2.x, v: base2.y };
    let faceCoord = apex.z;

    if (Math.abs(apex.x - base1.x) < 0.001 && Math.abs(apex.x - base2.x) < 0.001) {
      plane = 'ZY';
      maxD = this.bounds.w;
      a2d = { u: apex.z, v: apex.y };
      b1_2d = { u: base1.z, v: base1.y };
      b2_2d = { u: base2.z, v: base2.y };
      faceCoord = apex.x;
    } else if (Math.abs(apex.y - base1.y) < 0.001 && Math.abs(apex.y - base2.y) < 0.001) {
      plane = 'XZ';
      maxD = this.bounds.h;
      a2d = { u: apex.x, v: apex.z };
      b1_2d = { u: base1.x, v: base1.z };
      b2_2d = { u: base2.x, v: base2.z };
      faceCoord = apex.y;
    }

    const depth = this.isFullDepth ? maxD : Math.min(this.customDepth, maxD);
    let dMin = 0, dMax = maxD;
    if (!this.isFullDepth) {
      if (faceCoord >= maxD - 0.001) {
        // Cắt từ mặt ngoài bên phải/trên/trước vào trong
        dMin = maxD - depth;
        dMax = maxD;
      } else {
        // Cắt từ mặt bên trái/dưới/sau vào trong
        dMin = 0;
        dMax = depth;
      }
    }

    return { plane, a2d, b1_2d, b2_2d, dMin, dMax, maxD, apex, base1, base2 };
  }

  updatePreviewForVGroove() {
    const params = this.getVGrooveSliceParams();
    if (!params) return;
    this.preview.showVGroove(params.plane, params.a2d, params.b1_2d, params.b2_2d, params.dMin, params.dMax);
  }

  computeSlantParameters(p1, p2) {
    const dx = Math.abs(p1.x - p2.x);
    const dy = Math.abs(p1.y - p2.y);
    const dz = Math.abs(p1.z - p2.z);

    let plane = 'XY';
    let p1_2d, p2_2d, depthMin, depthMax;

    if (dz < 0.001) {
      plane = 'XY';
      p1_2d = { u: p1.x, v: p1.y };
      p2_2d = { u: p2.x, v: p2.y };
      depthMin = 0;
      depthMax = this.bounds.d;
    } else if (dx < 0.001) {
      plane = 'ZY';
      p1_2d = { u: p1.z, v: p1.y };
      p2_2d = { u: p2.z, v: p2.y };
      depthMin = 0;
      depthMax = this.bounds.w;
    } else if (dy < 0.001) {
      plane = 'XZ';
      p1_2d = { u: p1.x, v: p1.z };
      p2_2d = { u: p2.x, v: p2.z };
      depthMin = 0;
      depthMax = this.bounds.h;
    } else {
      if (dx >= dz) {
        plane = 'XY';
        p1_2d = { u: p1.x, v: p1.y };
        p2_2d = { u: p2.x, v: p2.y };
        depthMin = 0;
        depthMax = this.bounds.d;
      } else {
        plane = 'ZY';
        p1_2d = { u: p1.z, v: p1.y };
        p2_2d = { u: p2.z, v: p2.y };
        depthMin = 0;
        depthMax = this.bounds.w;
      }
    }

    return { plane, p1_2d, p2_2d, depthMin, depthMax };
  }

  toggleSlantDirection() {
    this.slantCutAbove = !this.slantCutAbove;
    if (this.selectedPoints.length === 3) {
      this.updatePreviewForPlane3Points();
    } else {
      this.updatePreviewForSlant();
    }
    this.updateHUD();
  }

  changeDepth(delta) {
    this.isFullDepth = false;
    let maxVal = this.bounds.d;
    if (this.mode === 'slant') {
      const sp = this.getSlantSliceParams();
      if (sp) maxVal = sp.maxD;
    } else if (this.mode === 'vgroove') {
      const vp = this.getVGrooveSliceParams();
      if (vp) maxVal = vp.maxD;
    }
    this.customDepth = Math.max(1, Math.min(maxVal, this.customDepth + delta));
    if (this.mode === 'vgroove') this.updatePreviewForVGroove();
    else if (this.mode === 'slant') this.updatePreviewForSlant();
    else if (this.mode === 'box') this.updatePreviewForBox();
    this.updateHUD();
  }

  setFullDepth() {
    this.isFullDepth = true;
    let maxVal = this.bounds.d;
    if (this.mode === 'slant') {
      const sp = this.getSlantSliceParams();
      if (sp) maxVal = sp.maxD;
    } else if (this.mode === 'vgroove') {
      const vp = this.getVGrooveSliceParams();
      if (vp) maxVal = vp.maxD;
    }
    this.customDepth = maxVal;
    if (this.mode === 'vgroove') this.updatePreviewForVGroove();
    else if (this.mode === 'slant') this.updatePreviewForSlant();
    else if (this.mode === 'box') this.updatePreviewForBox();
    this.updateHUD();
  }

  adjustCornerDelta(axis, change) {
    if (!this.cornerDelta) return;
    const current = Math.abs(this.cornerDelta[axis]);
    const maxVal = (axis === 'dx') ? this.bounds.w : (axis === 'dy') ? this.bounds.h : this.bounds.d;
    const newVal = Math.max(1, Math.min(maxVal, current + change));
    const sign = Math.sign(this.cornerDelta[axis]) || 1;
    this.cornerDelta[axis] = sign * newVal;
    this.updatePreviewForCorner();
    this.updateHUD();
  }

  executeCurrentCut() {
    if (!this.currentBrush) return;

    try {
      let newBrush = null;

      if (this.mode === 'corner') {
        const params = this.getCornerParams();
        if (!params) return;
        newBrush = this.cad.cutCorner3Points(
          this.currentBrush,
          params.p1,
          params.p2,
          params.p3,
          params.corner
        );

      } else if (this.mode === 'poly') {
        newBrush = this.cad.cutMultiPointVolume(
          this.currentBrush,
          this.selectedPoints,
          this.customDepth,
          this.isFullDepth
        );

      } else if (this.mode === 'slant') {
        if (this.selectedPoints.length === 3) {
          const [p1, p2, p3] = this.selectedPoints;
          newBrush = this.cad.cutPlane3Points(
            this.currentBrush,
            p1, p2, p3,
            this.slantCutAbove,
            this.isFullDepth
          );
        } else if (this.selectedPoints.length === 2) {
          const params = this.getSlantSliceParams();
          if (!params) return;
          newBrush = this.cad.cutSlant(
            this.currentBrush,
            params.plane,
            params.p1_2d,
            params.p2_2d,
            params.dMin,
            params.dMax,
            this.slantCutAbove
          );
        }

      } else if (this.mode === 'box') {
        const params = this.getBoxSliceParams();
        if (!params) return;
        newBrush = this.cad.cutBox(
          this.currentBrush,
          params.x1, params.x2,
          params.y1, params.y2,
          params.z1, params.z2
        );

      } else if (this.mode === 'vgroove') {
        const params = this.getVGrooveSliceParams();
        if (!params) return;
        newBrush = this.cad.cutVGroove(
          this.currentBrush,
          params.plane,
          params.a2d,
          params.b1_2d,
          params.b2_2d,
          params.dMin,
          params.dMax
        );
      }

      if (newBrush && this.callbacks.onCutExecute) {
        this.clearSelection();
        this.callbacks.onCutExecute(newBrush);
      }
    } catch (err) {
      console.error('Lỗi khi thực hiện cắt:', err);
      alert('Không thể thực hiện đường cắt với các điểm đã chọn! Hãy thử chọn lại.');
    }
  }

  // CẬP NHẬT THANH HUD VỚI ĐIỀU KHIỂN ĐỘ SÂU TRỰC TIẾP TẠI CHỖ
  updateHUD() {
    if (!this.hudElement) return;

    if (this.mode === 'view') {
      this.hudElement.innerHTML = `
        <div class="hud-step">
          <span class="hud-badge done">👁️ Chỉ Xem</span>
          <span>Đang ở chế độ xem kỹ thuật. Khối hiển thị sạch sẽ không vướng điểm. Bấm các nút công cụ trên thanh công cụ khi cần cắt.</span>
        </div>
      `;
      return;
    }

    const count = this.selectedPoints.length;
    let html = '';

    const depthText = this.isFullDepth ? `Xuyên suốt (${this.customDepth} ô)` : `${this.customDepth} ô`;

    if (this.mode === 'slant') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>ĐIỂM 1</b> trên mặt khối (Vát theo 2 điểm hoặc 3 điểm)</span>
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Điểm 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Hãy <b>Click chọn ĐIỂM 2</b> (hoặc click tiếp Điểm 3 để tạo Mặt Phẳng 3D)...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      } else if (count === 2) {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        const dirText = this.slantCutAbove ? 'Phía TRÊN' : 'Phía DƯỚI';
        html = `
          <div class="hud-actions">
            <div class="hud-coords">🟢 (${p1.x},${p1.y},${p1.z}) ➔ 🔵 (${p2.x},${p2.y},${p2.z})</div>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT VÁT (Enter)
            </button>
            <button class="hud-btn-action" id="hud-toggle-dir" title="Đổi phía không gian cắt">
              🔄 ${dirText}
            </button>
            <span style="font-size:12px; opacity:0.85; margin:0 4px;">👉 Hoặc click <b>ĐIỂM 3</b> để vát mặt phẳng 3D</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
          </div>
        `;
      } else {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        const p3 = this.selectedPoints[2];
        const dirText = this.slantCutAbove ? 'Bên Phải/Trên' : 'Bên Trái/Dưới';
        const boundText = this.isFullDepth ? 'Xuyên suốt khối' : 'Giới hạn theo điểm';
        html = `
          <div class="hud-actions">
            <div class="hud-coords">📐 Mặt phẳng 3D: 🟢 (${p1.x},${p1.y},${p1.z}) ➔ 🔵 (${p2.x},${p2.y},${p2.z}) ➔ 🟡 (${p3.x},${p3.y},${p3.z})</div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT MẶT PHẲNG (Enter)
            </button>
            <button class="hud-btn-action" id="hud-toggle-dir" title="Đổi chiều mặt phẳng cắt">
              🔄 Đổi bên vát (Tab)
            </button>
            <button class="hud-btn-toggle" id="hud-toggle-bound" title="Nhấn để đổi giữa giới hạn theo phạm vi điểm và xuyên suốt">
              🎯 ${boundText}
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      }

    } else if (this.mode === 'corner') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>3 ĐIỂM</b> trên 3 cạnh xuất phát từ góc cần vát</span>
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Điểm 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ HAI</b> trên cạnh thứ hai...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      } else if (count === 2) {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">2 Điểm</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ BA</b> trên cạnh thứ ba...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      } else {
        const params = this.getCornerParams();
        const o = params ? params.corner : { x: '?', y: '?', z: '?' };
        html = `
          <div class="hud-actions">
            <div class="hud-coords">🔺 Đỉnh góc: (${o.x}, ${o.y}, ${o.z})</div>
            <button class="hud-btn-action" id="hud-toggle-corner" title="Đổi hướng đỉnh góc vát">🔄 Đổi góc</button>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT GÓC (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
          </div>
        `;
      }

    } else if (this.mode === 'box') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>GÓC 1</b> của rãnh hộp trên mặt khối</span>
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Góc 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Click chọn <b>GÓC 2 ĐỐI DIỆN</b>...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      } else {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        html = `
          <div class="hud-actions">
            <div class="hud-coords">📦 (${p1.x},${p1.y},${p1.z}) ➔ (${p2.x},${p2.y},${p2.z})</div>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ KHOÉT HỘP (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
          </div>
        `;
      }

    } else if (this.mode === 'vgroove') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click <b>3 điểm</b> (Đỉnh & 2 chân đáy) theo ô lưới trên mặt khối</span>
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Điểm 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ HAI</b>...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      } else if (count === 2) {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">2 Điểm</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ BA</b>...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
          </div>
        `;
      } else {
        const vPts = this.getVGroovePoints();
        const ax = vPts ? vPts.apex : this.selectedPoints[0];
        html = `
          <div class="hud-actions">
            <div class="hud-coords">🔻 Đỉnh V: (${ax.x}, ${ax.y}, ${ax.z})</div>
            <button class="hud-btn-action" id="hud-toggle-apex" title="Đổi điểm làm đỉnh nhọn">🔄 Đổi đỉnh</button>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT RÃNH V (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
          </div>
        `;
      }
    }

    this.hudElement.innerHTML = html;

    const btnCut = document.getElementById('hud-cut-btn');
    if (btnCut) btnCut.addEventListener('click', () => this.executeCurrentCut());

    const btnCancel = document.getElementById('hud-cancel-btn');
    if (btnCancel) btnCancel.addEventListener('click', () => this.clearSelection());

    const btnRemovePt = document.getElementById('hud-remove-point');
    if (btnRemovePt) btnRemovePt.addEventListener('click', () => this.removeLastPoint());

    const btnToggleBound = document.getElementById('hud-toggle-bound');
    if (btnToggleBound) btnToggleBound.addEventListener('click', () => {
      this.isFullDepth = !this.isFullDepth;
      this.updatePreviewForPlane3Points();
      this.updateHUD();
    });

    const btnToggleDir = document.getElementById('hud-toggle-dir');
    if (btnToggleDir) btnToggleDir.addEventListener('click', () => this.toggleSlantDirection());

    const btnToggleApex = document.getElementById('hud-toggle-apex');
    if (btnToggleApex) btnToggleApex.addEventListener('click', () => this.cycleVApex());

    const btnToggleCorner = document.getElementById('hud-toggle-corner');
    if (btnToggleCorner) btnToggleCorner.addEventListener('click', () => this.cycleCornerO());

    const btnDepthMinus = document.getElementById('depth-minus');
    if (btnDepthMinus) btnDepthMinus.addEventListener('click', () => this.changeDepth(-1));

    const btnDepthPlus = document.getElementById('depth-plus');
    if (btnDepthPlus) btnDepthPlus.addEventListener('click', () => this.changeDepth(1));

    const btnDepthFull = document.getElementById('depth-full');
    if (btnDepthFull) btnDepthFull.addEventListener('click', () => this.setFullDepth());

    const btnMinus = document.getElementById('step-minus');
    if (btnMinus) btnMinus.addEventListener('click', () => {
      this.adjustCornerDelta('dx', -1);
      this.adjustCornerDelta('dy', -1);
      this.adjustCornerDelta('dz', -1);
    });

    const btnPlus = document.getElementById('step-plus');
    if (btnPlus) btnPlus.addEventListener('click', () => {
      this.adjustCornerDelta('dx', 1);
      this.adjustCornerDelta('dy', 1);
      this.adjustCornerDelta('dz', 1);
    });
  }
}
