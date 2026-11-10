import * as THREE from 'three';

/**
 * InspectionTool (Công cụ kiểm tra & đo đạc CAD 3D)
 * Hỗ trợ chuyên sâu cho chế độ "Chỉ Xem":
 * - Đo chiều dài cạnh (Click vào cạnh ➔ hiện kích thước CAD kèm mũi tên và số đo)
 * - Đo góc giữa 2 cạnh (Click Cạnh 1 ➔ Click Cạnh 2 ➔ hiện cung tròn đo góc 3D và số độ)
 * - Đo góc giữa 2 mặt (Click Mặt 1 ➔ Click Mặt 2 ➔ tính góc nhị diện giữa 2 mặt phẳng)
 * - Đo khoảng cách 2 điểm (Click Điểm 1 ➔ Click Điểm 2 ➔ hiện khoảng cách D và delta X, Y, Z)
 * - Lưu lại toàn bộ các số đo trên mô hình 3D cho đến khi người dùng bấm "Xóa hết"
 * - Quản lý danh sách số đo trực quan ở bảng công cụ bên phải (cho phép xóa lẻ từng mục)
 */
export class InspectionTool {
  constructor(scene, camera, renderer, controls, cad, callbacks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.cad = cad;
    this.callbacks = callbacks;

    this.container = renderer.domElement.parentElement;
    this.active = false;
    this.subMode = 'edge'; // 'edge', 'angle-edges', 'angle-faces', 'distance', 'none'

    // Nhóm 3D chứa tất cả các số đo đã lưu (Persistent Measurements)
    this.measurementsGroup = new THREE.Group();
    this.measurementsGroup.renderOrder = 1025;
    this.scene.add(this.measurementsGroup);

    // Nhóm 3D chứa các hiệu ứng xem trước khi hover / chọn tạm thời
    this.previewGroup = new THREE.Group();
    this.previewGroup.renderOrder = 1035;
    this.scene.add(this.previewGroup);

    this.measurements = []; // Danh sách các số đo đã lưu
    this.idCounter = 1;

    // Cache hình học
    this.currentBrush = null;
    this.currentEdges = null;
    this.edgesList = [];
    this.facesList = [];

    // Trạng thái chọn tạm thời khi đo góc / khoảng cách
    this.selectedEdge1 = null;
    this.selectedFace1 = null;
    this.selectedPoint1 = null;
    this.hoveredEdge = null;
    this.hoveredFace = null;

    // Raycasting & tương tác chuột
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.pointerDownPos = { x: 0, y: 0 };
    this.isPointerDown = false;

    // Tham chiếu các thành phần DOM
    this.panelElement = document.getElementById('inspection-panel');
    this.instructionElement = document.getElementById('measure-instruction');
    this.measureListElement = document.getElementById('measure-list');
    this.measureCountElement = document.getElementById('measure-count');

    this.initDOM();
    this.initEvents();
  }

  // Khởi tạo các sự kiện DOM trên bảng công cụ bên phải
  initDOM() {
    if (!this.panelElement) return;

    // Chuyển đổi các chế độ đo
    this.panelElement.querySelectorAll('.measure-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-measure-mode');
        this.setSubMode(mode);
      });
    });

    // Nút Xóa hết số đo
    const btnClearAll = document.getElementById('btn-clear-all-measures');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => this.clearAll());
    }

    // Nút Copy kết quả đo
    const btnCopy = document.getElementById('btn-copy-measures');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => this.copyToClipboard());
    }

    // Nút thu gọn / mở rộng bảng
    const btnCollapse = document.getElementById('btn-toggle-inspection-panel');
    if (btnCollapse) {
      btnCollapse.addEventListener('click', () => {
        const isCollapsed = this.panelElement.classList.toggle('collapsed');
        btnCollapse.textContent = isCollapsed ? '◀' : '▶';
        btnCollapse.title = isCollapsed ? 'Mở rộng bảng đo đạc' : 'Thu gọn bảng';
      });
    }
  }

  // Khởi tạo lắng nghe tương tác chuột trên viewport 3D
  initEvents() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.isPointerDown = true;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    dom.addEventListener('pointermove', (e) => {
      if (!this.active || this.isPointerDown) return;
      this.handlePointerMove(e);
    });

    window.addEventListener('pointerup', (e) => {
      if (!this.active || !this.isPointerDown) return;
      this.isPointerDown = false;

      // Phân biệt nhấp chuột (click) và kéo xoay camera (drag)
      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (dist > 6) return; // Người dùng vừa kéo xoay góc nhìn, không tính là click

      this.handleClick(e);
    });

    // Phím tắt nhanh
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'Escape') {
        this.resetSelection();
      } else if (e.key === 'Delete' || (e.ctrlKey && e.key.toLowerCase() === 'k')) {
        this.clearAll();
      } else if (e.key.toLowerCase() === 'm') {
        // Chu trình đổi chế độ đo: edge ➔ angle-edges ➔ angle-faces ➔ distance
        const modes = ['edge', 'angle-edges', 'angle-faces', 'distance'];
        const nextIdx = (modes.indexOf(this.subMode) + 1) % modes.length;
        this.setSubMode(modes[nextIdx]);
      }
    });
  }

  // Kích hoạt / Ẩn hiện công cụ
  show() {
    this.active = true;
    if (this.panelElement) {
      this.panelElement.style.display = 'flex';
      this.panelElement.classList.remove('collapsed');
    }
    this.updateInstruction();
    this.updateUIList();
  }

  hide() {
    this.active = false;
    this.resetSelection();
    this.clearPreview();
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
    }
  }

  // Đổi chế độ đo đạc con
  setSubMode(mode) {
    this.subMode = mode;
    this.resetSelection();
    this.clearPreview();

    if (this.panelElement) {
      this.panelElement.querySelectorAll('.measure-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-measure-mode') === mode);
      });
    }

    this.updateInstruction();
  }

  // Cập nhật câu hướng dẫn tương ứng trên thanh công cụ
  updateInstruction() {
    if (!this.instructionElement) return;

    if (this.subMode === 'edge') {
      this.instructionElement.innerHTML = `👉 <b>Rê chuột vào cạnh</b> để bắt dính, <b>Click</b> để hiển thị chiều dài CAD.`;
    } else if (this.subMode === 'angle-edges') {
      if (!this.selectedEdge1) {
        this.instructionElement.innerHTML = `👉 <b>Click CẠNH THỨ NHẤT</b> trên khối để bắt đầu đo góc.`;
      } else {
        this.instructionElement.innerHTML = `🟢 <b>Đã chọn Cạnh 1</b>. Hãy <b>Click CẠNH THỨ HAI</b> để tính góc giữa 2 cạnh.`;
      }
    } else if (this.subMode === 'angle-faces') {
      if (!this.selectedFace1) {
        this.instructionElement.innerHTML = `👉 <b>Click MẶT PHẲNG THỨ NHẤT</b> trên khối.`;
      } else {
        this.instructionElement.innerHTML = `🟢 <b>Đã chọn Mặt 1</b>. Hãy <b>Click MẶT THỨ HAI</b> để đo góc giữa 2 mặt.`;
      }
    } else if (this.subMode === 'distance') {
      if (!this.selectedPoint1) {
        this.instructionElement.innerHTML = `👉 <b>Click ĐIỂM THỨ NHẤT</b> (Đỉnh hoặc nút lưới) trên khối.`;
      } else {
        const p = this.selectedPoint1;
        this.instructionElement.innerHTML = `🟢 <b>Điểm 1 (${p.x}, ${p.y}, ${p.z})</b>. Hãy <b>Click ĐIỂM THỨ HAI</b> để đo khoảng cách.`;
      }
    } else {
      this.instructionElement.innerHTML = `👁️ Chế độ quan sát tự do.`;
    }
  }

  // Cập nhật khi mô hình khối 3D thay đổi (sau khi cắt gọt hoặc reset)
  updateModel(brush, edges) {
    this.currentBrush = brush;
    this.currentEdges = edges;
    this.cacheEdges();
    this.cacheFaces();
    this.resetSelection();
    this.clearPreview();
  }

  // Trích xuất toàn bộ danh sách các cạnh thực của khối 3D
  cacheEdges() {
    this.edgesList = [];
    if (!this.currentEdges || !this.currentEdges.geometry) return;
    const pos = this.currentEdges.geometry.attributes.position;
    if (!pos) return;

    for (let i = 0; i < pos.count; i += 2) {
      const p1 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const p2 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      const len = p1.distanceTo(p2);
      if (len > 0.005) {
        this.edgesList.push({
          id: `edge_${i / 2}`,
          p1,
          p2,
          len,
          mid: new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5),
          dir: new THREE.Vector3().subVectors(p2, p1).normalize()
        });
      }
    }
  }

  // Trích xuất danh sách các mặt phẳng của khối
  cacheFaces() {
    this.facesList = [];
    if (!this.currentBrush || !this.currentBrush.geometry) return;

    const nonIndexed = this.currentBrush.geometry.index
      ? this.currentBrush.geometry.toNonIndexed()
      : this.currentBrush.geometry;
    const pos = nonIndexed.attributes.position;
    const triCount = Math.floor(pos.count / 3);
    const triangles = [];

    for (let i = 0; i < triCount; i++) {
      const p0 = new THREE.Vector3(pos.getX(i * 3), pos.getY(i * 3), pos.getZ(i * 3));
      const p1 = new THREE.Vector3(pos.getX(i * 3 + 1), pos.getY(i * 3 + 1), pos.getZ(i * 3 + 1));
      const p2 = new THREE.Vector3(pos.getX(i * 3 + 2), pos.getY(i * 3 + 2), pos.getZ(i * 3 + 2));
      const norm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      if (norm.length() > 1e-5) {
        triangles.push({ p0, p1, p2, norm: norm.normalize() });
      }
    }

    for (const t of triangles) {
      let face = this.facesList.find(f =>
        f.norm.dot(t.norm) > 0.98 &&
        Math.abs(f.norm.dot(t.p0.clone().sub(f.p0))) < 0.02
      );
      if (face) {
        face.triangles.push(t);
      } else {
        this.facesList.push({
          id: `face_${this.facesList.length}`,
          norm: t.norm.clone(),
          p0: t.p0.clone(),
          triangles: [t]
        });
      }
    }

    // Tính tâm mặt phẳng
    for (const face of this.facesList) {
      const centroid = new THREE.Vector3();
      let count = 0;
      for (const t of face.triangles) {
        centroid.add(t.p0).add(t.p1).add(t.p2);
        count += 3;
      }
      face.centroid = centroid.multiplyScalar(1 / count);
    }
  }

  // Tìm cạnh gần nhất trong không gian màn hình 2D
  findNearestEdge(clientX, clientY) {
    if (!this.edgesList || this.edgesList.length === 0) return null;
    const rect = this.container.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    let bestEdge = null;
    let minScreenDist = 18; // Ngưỡng bắt dính: trong vòng 18 pixel
    let minZ = Infinity;

    const p1Screen = new THREE.Vector3();
    const p2Screen = new THREE.Vector3();

    for (const edge of this.edgesList) {
      p1Screen.copy(edge.p1).project(this.camera);
      p2Screen.copy(edge.p2).project(this.camera);

      // Nếu cả 2 điểm nằm phía sau camera
      if (p1Screen.z > 1 && p2Screen.z > 1) continue;

      const x1 = (p1Screen.x * 0.5 + 0.5) * width;
      const y1 = (-p1Screen.y * 0.5 + 0.5) * height;
      const x2 = (p2Screen.x * 0.5 + 0.5) * width;
      const y2 = (-p2Screen.y * 0.5 + 0.5) * height;

      const dist = this.pointToSegmentDistance2D(mouseX, mouseY, x1, y1, x2, y2);
      const avgZ = (p1Screen.z + p2Screen.z) * 0.5;

      if (dist < minScreenDist) {
        minScreenDist = dist;
        minZ = avgZ;
        bestEdge = edge;
      } else if (Math.abs(dist - minScreenDist) < 2 && avgZ < minZ) {
        minZ = avgZ;
        bestEdge = edge;
      }
    }

    return bestEdge;
  }

  pointToSegmentDistance2D(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) {
      const ddx = px - x1, ddy = py - y1;
      return Math.sqrt(ddx * ddx + ddy * ddy);
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const ex = px - projX;
    const ey = py - projY;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Tìm mặt phẳng được raycast trúng
  findHitFace(clientX, clientY) {
    if (!this.currentBrush) return null;
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObject(this.currentBrush);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const hitNorm = hit.face.normal.clone().transformDirection(this.currentBrush.matrixWorld).normalize();

    // Tìm mặt phẳng trong facesList tương ứng
    for (const face of this.facesList) {
      if (face.norm.dot(hitNorm) > 0.96) {
        const dist = Math.abs(face.norm.dot(hit.point.clone().sub(face.p0)));
        if (dist < 0.05) return face;
      }
    }

    return null;
  }

  // Tìm điểm đỉnh gần nhất để đo khoảng cách 2 điểm
  findNearestVertex(clientX, clientY) {
    const edge = this.findNearestEdge(clientX, clientY);
    if (!edge) return null;
    const rect = this.container.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    const p1s = edge.p1.clone().project(this.camera);
    const p2s = edge.p2.clone().project(this.camera);
    const x1 = (p1s.x * 0.5 + 0.5) * width;
    const y1 = (-p1s.y * 0.5 + 0.5) * height;
    const x2 = (p2s.x * 0.5 + 0.5) * width;
    const y2 = (-p2s.y * 0.5 + 0.5) * height;

    const d1 = Math.hypot(mouseX - x1, mouseY - y1);
    const d2 = Math.hypot(mouseX - x2, mouseY - y2);
    return (d1 <= d2) ? edge.p1.clone() : edge.p2.clone();
  }

  // Xử lý di chuột (Hover Highlight)
  handlePointerMove(e) {
    this.clearPreview();

    if (this.subMode === 'edge' || this.subMode === 'angle-edges') {
      const edge = this.findNearestEdge(e.clientX, e.clientY);
      this.hoveredEdge = edge;
      if (edge) {
        this.renderer.domElement.style.cursor = 'pointer';
        // Highlight cạnh đang rê chuột: Vàng neon sáng
        this.previewGroup.add(this.createEdgeHighlight(edge.p1, edge.p2, 0xfbbf24, 4));
      } else {
        this.renderer.domElement.style.cursor = 'grab';
      }

      // Giữ highlight cho Cạnh 1 đã chọn trước đó
      if (this.selectedEdge1) {
        this.previewGroup.add(this.createEdgeHighlight(this.selectedEdge1.p1, this.selectedEdge1.p2, 0x10b981, 4.5));
      }

    } else if (this.subMode === 'angle-faces') {
      const face = this.findHitFace(e.clientX, e.clientY);
      this.hoveredFace = face;
      if (face) {
        this.renderer.domElement.style.cursor = 'pointer';
        // Highlight mặt phẳng đang hover: Xanh cyan mờ
        this.previewGroup.add(this.createFaceHighlight(face, 0x38bdf8, 0.4));
      } else {
        this.renderer.domElement.style.cursor = 'grab';
      }

      // Giữ highlight cho Mặt 1 đã chọn trước đó: Xanh lục
      if (this.selectedFace1) {
        this.previewGroup.add(this.createFaceHighlight(this.selectedFace1, 0x10b981, 0.5));
      }

    } else if (this.subMode === 'distance') {
      const v = this.findNearestVertex(e.clientX, e.clientY);
      if (v) {
        this.renderer.domElement.style.cursor = 'crosshair';
        this.previewGroup.add(this.createPointHighlight(v, 0xfbbf24));
      } else {
        this.renderer.domElement.style.cursor = 'grab';
      }

      // Giữ highlight cho Điểm 1 đã chọn
      if (this.selectedPoint1) {
        this.previewGroup.add(this.createPointHighlight(this.selectedPoint1, 0x10b981));
      }
    }
  }

  // Xử lý nhấp chuột (Click)
  handleClick(e) {
    if (this.subMode === 'edge') {
      const edge = this.findNearestEdge(e.clientX, e.clientY);
      if (edge) {
        this.addMeasureEdge(edge);
      }

    } else if (this.subMode === 'angle-edges') {
      const edge = this.findNearestEdge(e.clientX, e.clientY);
      if (!edge) return;

      if (!this.selectedEdge1) {
        this.selectedEdge1 = edge;
        this.updateInstruction();
      } else {
        // Đã có Cạnh 1, giờ có Cạnh 2 ➔ Thực hiện đo góc
        const edge1 = this.selectedEdge1;
        const edge2 = edge;
        this.addMeasureAngleEdges(edge1, edge2);
        this.selectedEdge1 = null;
        this.updateInstruction();
      }

    } else if (this.subMode === 'angle-faces') {
      const face = this.findHitFace(e.clientX, e.clientY);
      if (!face) return;

      if (!this.selectedFace1) {
        this.selectedFace1 = face;
        this.updateInstruction();
      } else {
        // Đã có Mặt 1, giờ có Mặt 2 ➔ Thực hiện đo góc giữa 2 mặt
        const face1 = this.selectedFace1;
        const face2 = face;
        this.addMeasureAngleFaces(face1, face2);
        this.selectedFace1 = null;
        this.updateInstruction();
      }

    } else if (this.subMode === 'distance') {
      const pt = this.findNearestVertex(e.clientX, e.clientY);
      if (!pt) return;

      if (!this.selectedPoint1) {
        this.selectedPoint1 = pt;
        this.updateInstruction();
      } else {
        const p1 = this.selectedPoint1;
        const p2 = pt;
        this.addMeasureDistance(p1, p2);
        this.selectedPoint1 = null;
        this.updateInstruction();
      }
    }

    this.clearPreview();
  }

  // ==========================================
  // CÁC HÀM TẠO SỐ ĐO KỸ THUẬT (MEASURE BUILDERS)
  // ==========================================

  // 1. Thêm số đo chiều dài cạnh (Edge Length)
  addMeasureEdge(edge) {
    const id = `edge_${this.idCounter++}`;
    const p1 = edge.p1.clone();
    const p2 = edge.p2.clone();
    const len = edge.len;
    const lenStr = (Math.abs(len - Math.round(len)) < 0.01)
      ? `${Math.round(len)}`
      : len.toFixed(2);

    const group = new THREE.Group();
    group.name = id;

    // Đường viền sáng trên cạnh
    group.add(this.createEdgeHighlight(p1, p2, 0x38bdf8, 3));

    // Điểm đầu và cuối cạnh
    group.add(this.createPointHighlight(p1, 0x38bdf8, 0.07));
    group.add(this.createPointHighlight(p2, 0x38bdf8, 0.07));

    // Tính hướng gióng kích thước ra ngoài khối
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const boxCenter = new THREE.Vector3(3, 2, 2); // Khối hộp tham chiếu
    const outVec = new THREE.Vector3().subVectors(mid, boxCenter);
    const edgeDir = new THREE.Vector3().subVectors(p2, p1).normalize();
    const perp = new THREE.Vector3().subVectors(outVec, edgeDir.clone().multiplyScalar(outVec.dot(edgeDir)));
    if (perp.length() < 0.01) perp.set(0, 1, 0);
    perp.normalize();

    const offsetDist = 0.45;
    const dStart = p1.clone().addScaledVector(perp, offsetDist);
    const dEnd = p2.clone().addScaledVector(perp, offsetDist);

    // Đường gióng (Extension lines)
    const extPts = [
      p1.x, p1.y, p1.z, dStart.x + perp.x * 0.12, dStart.y + perp.y * 0.12, dStart.z + perp.z * 0.12,
      p2.x, p2.y, p2.z, dEnd.x + perp.x * 0.12, dEnd.y + perp.y * 0.12, dEnd.z + perp.z * 0.12
    ];
    const extGeom = new THREE.BufferGeometry();
    extGeom.setAttribute('position', new THREE.Float32BufferAttribute(extPts, 3));
    const extMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.8, depthTest: false });
    const extLines = new THREE.LineSegments(extGeom, extMat);
    extLines.renderOrder = 1022;
    group.add(extLines);

    // Đường kích thước chính + 2 Mũi tên CAD
    const mainPts = [dStart.x, dStart.y, dStart.z, dEnd.x, dEnd.y, dEnd.z];
    this.addCadArrowTip(mainPts, dStart, dEnd, perp, 0.22, 0.08);
    this.addCadArrowTip(mainPts, dEnd, dStart, perp, 0.22, 0.08);

    const mainGeom = new THREE.BufferGeometry();
    mainGeom.setAttribute('position', new THREE.Float32BufferAttribute(mainPts, 3));
    const mainMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, depthTest: false });
    const mainLine = new THREE.LineSegments(mainGeom, mainMat);
    mainLine.renderOrder = 1024;
    group.add(mainLine);

    // Nhãn số đo sắc nét (Sprite)
    const dimMid = new THREE.Vector3().addVectors(dStart, dEnd).multiplyScalar(0.5);
    const sprite = this.createTextSprite(`L: ${lenStr} ô`, '#38bdf8');
    sprite.position.copy(dimMid);
    group.add(sprite);

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'edge',
      title: `Cạnh: ${lenStr} ô`,
      sub: `P1(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)}, ${p1.z.toFixed(1)}) ➔ P2(${p2.x.toFixed(1)}, ${p2.y.toFixed(1)}, ${p2.z.toFixed(1)})`,
      group
    };

    this.measurements.push(item);
    this.updateUIList();
  }

  // 2. Thêm số đo góc giữa 2 cạnh (Angle between 2 Edges)
  addMeasureAngleEdges(edge1, edge2) {
    const id = `angle_${this.idCounter++}`;
    const group = new THREE.Group();
    group.name = id;

    // Highlight 2 cạnh: Cạnh 1 màu xanh lục, Cạnh 2 màu cam
    group.add(this.createEdgeHighlight(edge1.p1, edge1.p2, 0x10b981, 3.5));
    group.add(this.createEdgeHighlight(edge2.p1, edge2.p2, 0xf59e0b, 3.5));

    // Kiểm tra xem 2 cạnh có chung đỉnh hay không
    let V = null;
    let dir1 = new THREE.Vector3();
    let dir2 = new THREE.Vector3();

    if (edge1.p1.distanceTo(edge2.p1) < 0.05) {
      V = edge1.p1.clone();
      dir1.subVectors(edge1.p2, V).normalize();
      dir2.subVectors(edge2.p2, V).normalize();
    } else if (edge1.p1.distanceTo(edge2.p2) < 0.05) {
      V = edge1.p1.clone();
      dir1.subVectors(edge1.p2, V).normalize();
      dir2.subVectors(edge2.p1, V).normalize();
    } else if (edge1.p2.distanceTo(edge2.p1) < 0.05) {
      V = edge1.p2.clone();
      dir1.subVectors(edge1.p1, V).normalize();
      dir2.subVectors(edge2.p2, V).normalize();
    } else if (edge1.p2.distanceTo(edge2.p2) < 0.05) {
      V = edge1.p2.clone();
      dir1.subVectors(edge1.p1, V).normalize();
      dir2.subVectors(edge2.p1, V).normalize();
    }

    let angleDeg = 0;

    if (V) {
      // 2 CẠNH CẮT NHAU TẠI ĐỈNH V: Vẽ cung tròn đo góc 3D chuẩn xác
      const cosVal = Math.max(-1, Math.min(1, dir1.dot(dir2)));
      const angleRad = Math.acos(cosVal);
      angleDeg = (angleRad * 180) / Math.PI;

      const norm = new THREE.Vector3().crossVectors(dir1, dir2);
      let arcPts = [];
      const R = Math.max(0.4, Math.min(0.85, Math.min(edge1.len, edge2.len) * 0.45));

      if (norm.length() > 1e-4) {
        norm.normalize();
        const perp1 = new THREE.Vector3().crossVectors(norm, dir1).normalize();
        const segments = 24;
        for (let i = 0; i <= segments; i++) {
          const t = (i / segments) * angleRad;
          const pt = V.clone()
            .addScaledVector(dir1, Math.cos(t) * R)
            .addScaledVector(perp1, Math.sin(t) * R);
          arcPts.push(pt);
        }

        const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPts);
        const arcMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 2, depthTest: false });
        const arcLine = new THREE.Line(arcGeom, arcMat);
        arcLine.renderOrder = 1026;
        group.add(arcLine);

        // Vị trí đặt nhãn góc ở chính giữa cung tròn
        const midRad = angleRad / 2;
        const labelPos = V.clone()
          .addScaledVector(dir1, Math.cos(midRad) * (R + 0.4))
          .addScaledVector(perp1, Math.sin(midRad) * (R + 0.4));

        const sprite = this.createTextSprite(`Góc: ${angleDeg.toFixed(1)}°`, '#fbbf24');
        sprite.position.copy(labelPos);
        group.add(sprite);
      } else {
        // 2 cạnh cùng phương
        const sprite = this.createTextSprite(`Góc: ${angleDeg.toFixed(1)}°`, '#fbbf24');
        sprite.position.copy(V.clone().add(new THREE.Vector3(0, 0.4, 0)));
        group.add(sprite);
      }

    } else {
      // 2 CẠNH KHÔNG CHUNG ĐỈNH: Tính góc không gian giữa 2 vector chỉ phương
      const d1 = edge1.dir;
      const d2 = edge2.dir;
      const cosVal = Math.abs(d1.dot(d2));
      angleDeg = (Math.acos(Math.max(0, Math.min(1, cosVal))) * 180) / Math.PI;

      // Vẽ đường kết nối 2 trung điểm
      const linePts = [edge1.mid.x, edge1.mid.y, edge1.mid.z, edge2.mid.x, edge2.mid.y, edge2.mid.z];
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
      const mat = new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 0.2, gapSize: 0.1, depthTest: false });
      const line = new THREE.LineSegments(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 1024;
      group.add(line);

      const midMid = new THREE.Vector3().addVectors(edge1.mid, edge2.mid).multiplyScalar(0.5);
      const sprite = this.createTextSprite(`Góc: ${angleDeg.toFixed(1)}°`, '#fbbf24');
      sprite.position.copy(midMid);
      group.add(sprite);
    }

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'angle-edges',
      title: `Góc 2 Cạnh: ${angleDeg.toFixed(1)}°`,
      sub: V ? `Giao đỉnh tại (${V.x.toFixed(1)}, ${V.y.toFixed(1)}, ${V.z.toFixed(1)})` : `2 cạnh chéo/song song`,
      group
    };

    this.measurements.push(item);
    this.updateUIList();
  }

  // 3. Thêm số đo góc giữa 2 mặt (Dihedral Angle between 2 Faces)
  addMeasureAngleFaces(face1, face2) {
    const id = `angle_face_${this.idCounter++}`;
    const group = new THREE.Group();
    group.name = id;

    // Highlight 2 mặt phẳng: Mặt 1 xanh lục, Mặt 2 cam
    group.add(this.createFaceHighlight(face1, 0x10b981, 0.45));
    group.add(this.createFaceHighlight(face2, 0xf59e0b, 0.45));

    // Tính góc giữa 2 pháp tuyến
    const dot = Math.max(-1, Math.min(1, face1.norm.dot(face2.norm)));
    const normAngleRad = Math.acos(dot);
    const normAngleDeg = (normAngleRad * 180) / Math.PI;

    // Góc nhị diện (Dihedral Angle): góc giữa 2 bề mặt thực tế
    let dihedralDeg = 180 - normAngleDeg;
    if (Math.abs(dot) < 0.01) dihedralDeg = 90.0;

    // Vị trí đặt nhãn tại trung điểm giữa 2 tâm mặt
    const midPos = new THREE.Vector3().addVectors(face1.centroid, face2.centroid).multiplyScalar(0.5);
    const sprite = this.createTextSprite(`Góc 2 Mặt: ${dihedralDeg.toFixed(1)}°`, '#a855f7');
    sprite.position.copy(midPos);
    group.add(sprite);

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'angle-faces',
      title: `Góc 2 Mặt: ${dihedralDeg.toFixed(1)}°`,
      sub: `Pháp tuyến N1 ∡ N2 = ${normAngleDeg.toFixed(1)}°`,
      group
    };

    this.measurements.push(item);
    this.updateUIList();
  }

  // 4. Thêm số đo khoảng cách giữa 2 điểm (Distance between 2 Points)
  addMeasureDistance(p1, p2) {
    const id = `dist_${this.idCounter++}`;
    const group = new THREE.Group();
    group.name = id;

    const dist = p1.distanceTo(p2);
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    const dz = Math.abs(p2.z - p1.z);

    // Điểm đầu và cuối
    group.add(this.createPointHighlight(p1, 0xec4899, 0.08));
    group.add(this.createPointHighlight(p2, 0xec4899, 0.08));

    // Đường nối thẳng đứt đoạn
    const linePts = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xec4899, linewidth: 2.5, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 1024;
    group.add(line);

    // Nhãn số đo
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const sprite = this.createTextSprite(`D = ${dist.toFixed(2)} ô`, '#ec4899');
    sprite.position.copy(mid);
    group.add(sprite);

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'distance',
      title: `Khoảng cách: ${dist.toFixed(2)} ô`,
      sub: `ΔX: ${dx.toFixed(1)} | ΔY: ${dy.toFixed(1)} | ΔZ: ${dz.toFixed(1)}`,
      group
    };

    this.measurements.push(item);
    this.updateUIList();
  }

  // ==========================================
  // QUẢN LÝ XÓA & SAO CHÉP (CLEANUP & CLIPBOARD)
  // ==========================================

  // Xóa toàn bộ số đo đang lưu trên hình
  clearAll() {
    while (this.measurementsGroup.children.length > 0) {
      const obj = this.measurementsGroup.children[0];
      this.measurementsGroup.remove(obj);
      this.disposeObject(obj);
    }

    this.measurements = [];
    this.resetSelection();
    this.clearPreview();
    this.updateUIList();
  }

  // Xóa riêng lẻ 1 số đo
  removeMeasurement(id) {
    const idx = this.measurements.findIndex(m => m.id === id);
    if (idx !== -1) {
      const item = this.measurements[idx];
      this.measurementsGroup.remove(item.group);
      this.disposeObject(item.group);
      this.measurements.splice(idx, 1);
      this.updateUIList();
    }
  }

  // Sao chép toàn bộ danh sách kết quả đo ra Clipboard
  copyToClipboard() {
    if (this.measurements.length === 0) {
      alert('Chưa có số đo nào để sao chép!');
      return;
    }

    const lines = this.measurements.map((m, idx) => `${idx + 1}. ${m.title} (${m.sub})`);
    const text = `--- KẾT QUẢ ĐO ĐẠC CAD 3D ---\n` + lines.join('\n');

    navigator.clipboard.writeText(text).then(() => {
      alert('Đã sao chép toàn bộ kết quả đo vào Clipboard!');
    }).catch(err => {
      console.error('Lỗi sao chép:', err);
    });
  }

  resetSelection() {
    this.selectedEdge1 = null;
    this.selectedFace1 = null;
    this.selectedPoint1 = null;
    this.updateInstruction();
  }

  clearPreview() {
    while (this.previewGroup.children.length > 0) {
      const obj = this.previewGroup.children[0];
      this.previewGroup.remove(obj);
      this.disposeObject(obj);
    }
  }

  // Cập nhật danh sách trên giao diện bảng điều khiển bên phải
  updateUIList() {
    if (this.measureCountElement) {
      this.measureCountElement.textContent = this.measurements.length;
    }

    if (!this.measureListElement) return;

    if (this.measurements.length === 0) {
      this.measureListElement.innerHTML = `
        <div class="empty-measure-hint">
          Chưa có số đo nào.<br>Hãy click vào cạnh hoặc góc trên khối để bắt đầu đo!
        </div>
      `;
      return;
    }

    let html = '';
    for (const item of this.measurements) {
      let icon = '📏';
      if (item.type === 'angle-edges' || item.type === 'angle-faces') icon = '📐';
      else if (item.type === 'distance') icon = '🎯';

      html += `
        <div class="measure-item" data-id="${item.id}">
          <div class="measure-item-icon">${icon}</div>
          <div class="measure-item-info">
            <div class="measure-item-title">${item.title}</div>
            <div class="measure-item-sub">${item.sub}</div>
          </div>
          <button class="measure-item-del" data-del-id="${item.id}" title="Xóa số đo này">✖</button>
        </div>
      `;
    }

    this.measureListElement.innerHTML = html;

    // Gắn sự kiện xóa lẻ
    this.measureListElement.querySelectorAll('.measure-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const delId = btn.getAttribute('data-del-id');
        this.removeMeasurement(delId);
      });
    });

    // Hover mục trong list để nhấp nháy highlight trong 3D
    this.measureListElement.querySelectorAll('.measure-item').forEach(itemEl => {
      itemEl.addEventListener('mouseenter', () => {
        const itemId = itemEl.getAttribute('data-id');
        const found = this.measurements.find(m => m.id === itemId);
        if (found && found.group) {
          found.group.scale.set(1.05, 1.05, 1.05);
        }
      });
      itemEl.addEventListener('mouseleave', () => {
        const itemId = itemEl.getAttribute('data-id');
        const found = this.measurements.find(m => m.id === itemId);
        if (found && found.group) {
          found.group.scale.set(1, 1, 1);
        }
      });
    });
  }

  // ==========================================
  // CÁC HÀM TIỆN ÍCH ĐỒ HỌA 3D (GRAPHIC HELPERS)
  // ==========================================

  // Highlight một đoạn thẳng cạnh
  createEdgeHighlight(p1, p2, colorHex = 0xfbbf24, linewidth = 3) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], 3));
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      linewidth,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });
    const line = new THREE.LineSegments(geom, mat);
    line.renderOrder = 1030;
    return line;
  }

  // Highlight một điểm (Sphere marker)
  createPointHighlight(p, colorHex = 0xfbbf24, radius = 0.08) {
    const geom = new THREE.SphereGeometry(radius, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(p);
    mesh.renderOrder = 1032;
    return mesh;
  }

  // Highlight một mặt phẳng (Translucent mesh)
  createFaceHighlight(face, colorHex = 0x38bdf8, opacity = 0.4) {
    const group = new THREE.Group();
    const positions = [];

    for (const t of face.triangles) {
      positions.push(
        t.p0.x, t.p0.y, t.p0.z,
        t.p1.x, t.p1.y, t.p1.z,
        t.p2.x, t.p2.y, t.p2.z
      );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 1020;
    group.add(mesh);

    return group;
  }

  // Mũi tên CAD dạng vạch tại đầu kích thước
  addCadArrowTip(linePts, tip, fromPt, perpVec, arrowLen = 0.22, arrowWing = 0.08) {
    const dir = new THREE.Vector3().subVectors(fromPt, tip).normalize();
    const perp = perpVec.clone().normalize();
    const back = tip.clone().addScaledVector(dir, arrowLen);
    const wing1 = back.clone().addScaledVector(perp, arrowWing);
    const wing2 = back.clone().addScaledVector(perp, -arrowWing);

    linePts.push(
      tip.x, tip.y, tip.z, wing1.x, wing1.y, wing1.z,
      tip.x, tip.y, tip.z, wing2.x, wing2.y, wing2.z
    );
  }

  // Tạo sprite nhãn số đo sắc nét từ 2D Canvas
  createTextSprite(text, borderColor = '#38bdf8', bgColor = 'rgba(15, 23, 42, 0.95)') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = 2;
    canvas.width = 240 * dpr;
    canvas.height = 70 * dpr;
    ctx.scale(dpr, dpr);

    const w = 240, h = 70;
    const boxW = 160, boxH = 40;
    const x = (w - boxW) / 2;
    const y = (h - boxH) / 2;

    // Viên thuốc bo góc
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 10);
    ctx.fill();
    ctx.stroke();

    // Text chữ số đo
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1040;
    sprite.scale.set(1.3, 0.38, 1);
    return sprite;
  }

  disposeObject(obj) {
    if (!obj) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
    if (obj.children) {
      for (const child of obj.children) {
        this.disposeObject(child);
      }
    }
  }
}
