import * as THREE from 'three';

/**
 * InspectionTool (Công cụ kiểm tra & đo đạc CAD 3D)
 * Hỗ trợ chuyên sâu cho chế độ "Chỉ Xem":
 * - Đo chiều dài cạnh (Tự động gộp các đoạn chéo/thẳng bị đứt nét do tam giác hóa thành 1 cạnh dài hoàn chỉnh)
 * - Đo góc giữa 2 cạnh (Nhận diện đỉnh giao nhau, vẽ cung tròn góc 3D chuẩn CAD và số độ)
 * - Đo góc giữa 2 mặt (Nhận diện chính xác từng vùng mặt phẳng kết nối, tính góc nhị diện thực tế)
 * - Đo khoảng cách 2 điểm (Click 2 đỉnh bất kỳ ➔ hiện khoảng cách D và ΔX, ΔY, ΔZ)
 * - Nút thu gọn / mở lại thông minh (luôn có nút nổi ở mép phải, không bao giờ bị mất)
 * - Lưu lại toàn bộ số đo trên 3D cho đến khi người dùng bấm "Xóa hết"
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
    this.subMode = 'edge'; // 'edge', 'angle-edges', 'angle-faces', 'distance'
    this.isCollapsed = false;

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
    this.triangleToFaceMap = [];

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
    this.floatingBtn = document.getElementById('btn-floating-open-inspect');
    this.instructionElement = document.getElementById('measure-instruction');
    this.measureListElement = document.getElementById('measure-list');
    this.measureCountElement = document.getElementById('measure-count');

    this.initDOM();
    this.initEvents();
  }

  setProjectionScreens(screens) {
    this.projectionScreens = screens;
    this.projectionScreens.onUpdate = () => {
      this.cacheEdges();
    };
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

    // Nút thu gọn bảng (▶)
    const btnCollapse = document.getElementById('btn-toggle-inspection-panel');
    if (btnCollapse) {
      btnCollapse.addEventListener('click', () => this.collapsePanel());
    }

    // Nút mở lại bảng khi đã thu gọn (🔍 Đo Đạc ◀)
    if (this.floatingBtn) {
      this.floatingBtn.addEventListener('click', () => this.expandPanel());
    }

    // Nút Bật/Tắt Ô vuông trong bảng Chỉ Xem
    const btnToggleGrid = document.getElementById('inspect-toggle-grid');
    if (btnToggleGrid) {
      btnToggleGrid.addEventListener('click', () => {
        if (this.callbacks.onToggleGridSquares) this.callbacks.onToggleGridSquares();
      });
    }

    // Nút Bật/Tắt Số đo khối trong bảng Chỉ Xem
    const btnToggleDim = document.getElementById('inspect-toggle-dim');
    if (btnToggleDim) {
      btnToggleDim.addEventListener('click', () => {
        if (this.callbacks.onToggleDim) this.callbacks.onToggleDim();
      });
    }

    // Nút Bật/Tắt Màn Chiếu 2D trong bảng Chỉ Xem
    const btnToggleScreens = document.getElementById('inspect-toggle-screens');
    if (btnToggleScreens) {
      btnToggleScreens.addEventListener('click', () => {
        if (this.callbacks.onToggleScreens) this.callbacks.onToggleScreens();
      });
    }
  }

  syncGridSquaresUI(visible) {
    const btn = document.getElementById('inspect-toggle-grid');
    const lbl = document.getElementById('lbl-inspect-grid');
    if (btn) btn.classList.toggle('active', visible);
    if (lbl) lbl.textContent = visible ? 'Ô Vuông: BẬT' : 'Ô Vuông: TẮT';
  }

  syncDimUI(enabled) {
    const btn = document.getElementById('inspect-toggle-dim');
    const lbl = document.getElementById('lbl-inspect-dim');
    if (btn) btn.classList.toggle('active', enabled);
    if (lbl) lbl.textContent = enabled ? 'Số Đo: BẬT' : 'Số Đo: TẮT';
  }

  syncScreensUI(enabled) {
    const btn = document.getElementById('inspect-toggle-screens');
    const lbl = document.getElementById('lbl-inspect-screens');
    if (btn) btn.classList.toggle('active', enabled);
    if (lbl) lbl.textContent = enabled ? 'Màn Chiếu: BẬT' : 'Màn Chiếu: TẮT';
  }

  // Thu gọn bảng đo đạc
  collapsePanel() {
    this.isCollapsed = true;
    if (this.panelElement) this.panelElement.style.display = 'none';
    if (this.floatingBtn && this.active) {
      this.floatingBtn.style.display = 'flex';
    }
  }

  // Mở rộng lại bảng đo đạc
  expandPanel() {
    this.isCollapsed = false;
    if (this.panelElement) this.panelElement.style.display = 'flex';
    if (this.floatingBtn) this.floatingBtn.style.display = 'none';
  }

  // Khởi tạo lắng nghe tương tác chuột trên viewport 3D
  initEvents() {
    const dom = this.renderer.domElement;
    const activePointers = new Set();

    dom.addEventListener('pointerdown', (e) => {
      activePointers.add(e.pointerId);
      if (!this.active) return;
      if (activePointers.size > 1) {
        // Đa chạm (pinch zoom / pan) -> không tính click đo
        this.isPointerDown = false;
        return;
      }
      this.isPointerDown = true;
      this.pointerDownId = e.pointerId;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    dom.addEventListener('pointermove', (e) => {
      if (!this.active || this.isPointerDown) return;
      this.handlePointerMove(e);
    });

    window.addEventListener('pointerup', (e) => {
      activePointers.delete(e.pointerId);
      if (!this.active || !this.isPointerDown || e.pointerId !== this.pointerDownId) return;
      this.isPointerDown = false;

      // Phân biệt chạm/nhấp chuột (click) và kéo xoay camera (drag)
      const maxMove = (e.pointerType === 'touch') ? 12 : 6;
      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (dist > maxMove) return;

      this.handleClick(e);
    });

    window.addEventListener('pointercancel', (e) => {
      activePointers.delete(e.pointerId);
      if (e.pointerId === this.pointerDownId) {
        this.isPointerDown = false;
      }
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
        const modes = ['edge', 'angle-edges', 'angle-faces', 'distance'];
        const nextIdx = (modes.indexOf(this.subMode) + 1) % modes.length;
        this.setSubMode(modes[nextIdx]);
      } else if (e.key.toLowerCase() === 'p') {
        if (this.callbacks.onToggleScreens) this.callbacks.onToggleScreens();
      }
    });
  }

  // Kích hoạt khi vào tab "Chỉ Xem"
  show() {
    this.active = true;
    this.measurementsGroup.visible = true;
    this.previewGroup.visible = true;
    if (this.isCollapsed) {
      if (this.panelElement) this.panelElement.style.display = 'none';
      if (this.floatingBtn) this.floatingBtn.style.display = 'flex';
    } else {
      if (this.panelElement) this.panelElement.style.display = 'flex';
      if (this.floatingBtn) this.floatingBtn.style.display = 'none';
    }
    this.updateInstruction();
    this.updateUIList();
  }

  // Ẩn khi rời khỏi tab "Chỉ Xem" (Cắt gọt hoặc chuyển sang 2D CAD)
  hide() {
    this.active = false;
    this.measurementsGroup.visible = false;
    this.previewGroup.visible = false;
    this.resetSelection();
    this.clearPreview();
    if (this.panelElement) this.panelElement.style.display = 'none';
    if (this.floatingBtn) this.floatingBtn.style.display = 'none';
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
        this.instructionElement.innerHTML = `🟢 <b>Điểm 1 (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})</b>. Hãy <b>Click ĐIỂM THỨ HAI</b> để đo khoảng cách.`;
      }
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

  // =========================================================================
  // GỘP CÁC ĐOẠN THẲNG CÙNG PHƯƠNG THÀNH CẠNH LIỀN HOÀN CHỈNH (HEAL COLLINEAR EDGES)
  // Khắc phục triệt để lỗi đoạn chéo nét bị đứt nửa chừng do phân chia tam giác CSG
  // =========================================================================
  cacheEdges() {
    this.edgesList = [];
    if (!this.currentEdges || !this.currentEdges.geometry) return;
    const pos = this.currentEdges.geometry.attributes.position;
    if (!pos || pos.count === 0) return;

    const rawSegments = [];
    for (let i = 0; i < pos.count; i += 2) {
      const p1 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const p2 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      const len = p1.distanceTo(p2);
      if (len > 0.005) {
        const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
        rawSegments.push({ p1, p2, len, dir, merged: false });
      }
    }

    // Thuật toán gộp các đoạn thẳng cùng phương trên cùng đường thẳng 3D (1D Interval Projection)
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < rawSegments.length; i++) {
        if (rawSegments[i].merged) continue;
        const s1 = rawSegments[i];
        const u = s1.dir;
        const p0 = s1.p1;

        for (let j = i + 1; j < rawSegments.length; j++) {
          if (rawSegments[j].merged) continue;
          const s2 = rawSegments[j];

          // 1. Kiểm tra cùng phương (song song hoặc ngược chiều)
          const dot = Math.abs(u.dot(s2.dir));
          if (dot < 0.99) continue;

          // 2. Kiểm tra s2 có nằm trên cùng đường thẳng 3D đi qua p0 với vector chỉ phương u
          const v1 = new THREE.Vector3().subVectors(s2.p1, p0);
          const proj1 = v1.dot(u);
          const dist1 = new THREE.Vector3().subVectors(v1, u.clone().multiplyScalar(proj1)).length();
          if (dist1 > 0.05) continue;

          const v2 = new THREE.Vector3().subVectors(s2.p2, p0);
          const proj2 = v2.dot(u);
          const dist2 = new THREE.Vector3().subVectors(v2, u.clone().multiplyScalar(proj2)).length();
          if (dist2 > 0.05) continue;

          // 3. Tính khoảng 1D (Intervals) của cả 2 đoạn trên trục u
          const int1Min = 0;
          const int1Max = s1.len;
          const int2Min = Math.min(proj1, proj2);
          const int2Max = Math.max(proj1, proj2);

          // 4. Kiểm tra xem 2 khoảng có giao nhau hoặc tiếp giáp (cho phép khe hở sai số <= 0.06)
          const gap = Math.max(0, -int2Max, int2Min - int1Max);
          if (gap <= 0.06) {
            const newMin = Math.min(int1Min, int2Min);
            const newMax = Math.max(int1Max, int2Max);

            s1.p1 = p0.clone().addScaledVector(u, newMin);
            s1.p2 = p0.clone().addScaledVector(u, newMax);
            s1.len = newMax - newMin;
            s1.dir = u;
            s2.merged = true;
            changed = true;
            break;
          }
        }
      }
    }

    // Lưu danh sách cạnh đã được nối liền hoàn hảo
    for (const s of rawSegments) {
      if (!s.merged && s.len > 0.01) {
        this.edgesList.push({
          id: `edge_${this.edgesList.length}`,
          p1: s.p1,
          p2: s.p2,
          len: s.len,
          mid: new THREE.Vector3().addVectors(s.p1, s.p2).multiplyScalar(0.5),
          dir: s.dir
        });
      }
    }

    // Thêm các cạnh trên 3 Màn Chiếu Kỹ Thuật (nếu đang bật màn chiếu) để đo trực tiếp cạnh & góc trên màn chiếu
    if (this.projectionScreens && this.projectionScreens.enabled && this.projectionScreens.screenEdges) {
      for (const se of this.projectionScreens.screenEdges) {
        this.edgesList.push(se);
      }
    }
  }

  // =========================================================================
  // PHÂN NHÓM MẶT PHẲNG KẾT NỐI (BFS CONNECTIVITY CLUSTERING)
  // Khắc phục lỗi chọn mặt không đúng, không gộp nhầm các mặt rời nhau
  // =========================================================================
  cacheFaces() {
    this.facesList = [];
    this.triangleToFaceMap = [];
    if (!this.currentBrush || !this.currentBrush.geometry) return;

    const geom = this.currentBrush.geometry.index
      ? this.currentBrush.geometry.toNonIndexed()
      : this.currentBrush.geometry;
    const pos = geom.attributes.position;
    const triCount = Math.floor(pos.count / 3);
    if (triCount === 0) return;

    // 1. Tính toán normal chính xác và lập chỉ mục đỉnh cho từng tam giác
    const triangles = [];
    const vKey = (x, y, z) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100},${Math.round(z * 100) / 100}`;
    const vertexToTris = new Map();

    for (let i = 0; i < triCount; i++) {
      const idx = i * 3;
      const p0 = new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
      const p1 = new THREE.Vector3(pos.getX(idx + 1), pos.getY(idx + 1), pos.getZ(idx + 1));
      const p2 = new THREE.Vector3(pos.getX(idx + 2), pos.getY(idx + 2), pos.getZ(idx + 2));

      const e1 = new THREE.Vector3().subVectors(p1, p0);
      const e2 = new THREE.Vector3().subVectors(p2, p0);
      const cross = new THREE.Vector3().crossVectors(e1, e2);
      const area = cross.length();
      const norm = (area > 1e-6) ? cross.clone().normalize() : new THREE.Vector3(0, 1, 0);

      const k0 = vKey(p0.x, p0.y, p0.z);
      const k1 = vKey(p1.x, p1.y, p1.z);
      const k2 = vKey(p2.x, p2.y, p2.z);

      triangles.push({ i, p0, p1, p2, norm, k0, k1, k2, area });

      for (const k of [k0, k1, k2]) {
        if (!vertexToTris.has(k)) vertexToTris.set(k, []);
        vertexToTris.get(k).push(i);
      }
    }

    // 2. Gom cụm các tam giác ĐỒNG PHẲNG VÀ KẾT NỐI LIỀN NHAU (Connected Components)
    const visited = new Uint8Array(triCount);
    this.triangleToFaceMap = new Array(triCount);

    for (let i = 0; i < triCount; i++) {
      if (visited[i]) continue;
      const seed = triangles[i];
      const faceTriangles = [];
      const queue = [i];
      visited[i] = 1;

      const baseNorm = seed.norm.clone();
      const baseP0 = seed.p0.clone();
      const faceIndex = this.facesList.length;

      while (queue.length > 0) {
        const currIdx = queue.pop();
        const currTri = triangles[currIdx];
        faceTriangles.push(currTri);
        this.triangleToFaceMap[currIdx] = faceIndex;

        // Loang qua các tam giác lân cận có chung đỉnh
        for (const vk of [currTri.k0, currTri.k1, currTri.k2]) {
          const neighbors = vertexToTris.get(vk) || [];
          for (const nbrIdx of neighbors) {
            if (visited[nbrIdx]) continue;
            const nbrTri = triangles[nbrIdx];

            // Tiêu chuẩn đồng phẳng: cùng pháp tuyến và cùng khoảng cách mặt phẳng
            if (nbrTri.norm.dot(baseNorm) > 0.985) {
              const dist = Math.abs(baseNorm.dot(nbrTri.p0.clone().sub(baseP0)));
              if (dist < 0.015) {
                visited[nbrIdx] = 1;
                queue.push(nbrIdx);
              }
            }
          }
        }
      }

      // Tính trọng tâm centroid của mặt phẳng
      const centroid = new THREE.Vector3();
      let totalArea = 0;
      for (const t of faceTriangles) {
        const triCenter = new THREE.Vector3().add(t.p0).add(t.p1).add(t.p2).multiplyScalar(1 / 3);
        centroid.addScaledVector(triCenter, t.area);
        totalArea += t.area;
      }
      if (totalArea > 0) centroid.multiplyScalar(1 / totalArea);
      else centroid.copy(baseP0);

      this.facesList.push({
        id: `face_${faceIndex}`,
        norm: baseNorm,
        centroid,
        p0: baseP0,
        triangles: faceTriangles
      });
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
    let minScreenDist = 22; // Ngưỡng bắt dính: 22 pixel
    let minZ = Infinity;

    const p1Screen = new THREE.Vector3();
    const p2Screen = new THREE.Vector3();
    const occRay = new THREE.Raycaster();

    // Lấy danh sách các tấm nền màn chiếu đang hiển thị (nếu có)
    const screenPanels = (this.projectionScreens && this.projectionScreens.getScreenPanels)
      ? this.projectionScreens.getScreenPanels()
      : [];

    // Kiểm tra xem chuột có đang trỏ thẳng vào tấm màn chiếu nào không
    let mouseHitScreen = false;
    let mouseHitScreenDist = Infinity;
    if (screenPanels.length > 0) {
      const mouseRay = new THREE.Raycaster();
      const mouseNDC = new THREE.Vector2(
        (mouseX / width) * 2 - 1,
        -(mouseY / height) * 2 + 1
      );
      mouseRay.setFromCamera(mouseNDC, this.camera);
      const sHits = mouseRay.intersectObjects(screenPanels, false);
      if (sHits.length > 0) {
        mouseHitScreen = true;
        mouseHitScreenDist = sHits[0].distance;
      }
    }

    for (const edge of this.edgesList) {
      p1Screen.copy(edge.p1).project(this.camera);
      p2Screen.copy(edge.p2).project(this.camera);

      // Bỏ qua nếu cả 2 điểm nằm ngoài tầm nhìn
      if (p1Screen.z > 1 && p2Screen.z > 1) continue;

      const x1 = (p1Screen.x * 0.5 + 0.5) * width;
      const y1 = (-p1Screen.y * 0.5 + 0.5) * height;
      const x2 = (p2Screen.x * 0.5 + 0.5) * width;
      const y2 = (-p2Screen.y * 0.5 + 0.5) * height;

      const dist = this.pointToSegmentDistance2D(mouseX, mouseY, x1, y1, x2, y2);
      if (dist >= minScreenDist) continue;

      // KIỂM TRA CHE KHUẤT BỞI MÀN CHIẾU KỸ THUẬT:
      // A. Nếu chuột đang trỏ trên màn chiếu, tuyệt đối không bắt dính cạnh của khối 3D phía sau màn chiếu
      if (mouseHitScreen && !edge.isScreenEdge) {
        continue;
      }

      // B. Kiểm tra nếu có màn chiếu nào chắn giữa camera và trung điểm cạnh của khối 3D
      if (!edge.isScreenEdge && screenPanels.length > 0) {
        const camPos = this.camera.position;
        const dirToMid = new THREE.Vector3().subVectors(edge.mid, camPos);
        const distToEdge = dirToMid.length();
        dirToMid.normalize();
        occRay.set(camPos, dirToMid);
        const sOccHits = occRay.intersectObjects(screenPanels, false);
        if (sOccHits.length > 0 && sOccHits[0].distance < distToEdge - 0.08) {
          continue; // Màn chiếu đục nằm chắn ngay trước cạnh!
        }
      }

      // C. KIỂM TRA CHE KHUẤT HÌNH HỌC BỞI CHÍNH KHỐI 3D
      if (!edge.isScreenEdge && this.currentBrush) {
        const midNDC = edge.mid.clone().project(this.camera);
        if (midNDC.z >= -1 && midNDC.z <= 1) {
          occRay.setFromCamera({ x: midNDC.x, y: midNDC.y }, this.camera);
          const hits = occRay.intersectObject(this.currentBrush, false);
          if (hits.length > 0) {
            const distToEdge = occRay.ray.origin.distanceTo(edge.mid);
            if (hits[0].distance < distToEdge - 0.15) {
              continue; // Bị mặt trước của khối che khuất!
            }
          }
        }
      }

      const avgZ = (p1Screen.z + p2Screen.z) * 0.5;
      if (dist < minScreenDist - 2 || avgZ < minZ) {
        minScreenDist = dist;
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

  // Tìm mặt phẳng được raycast trúng (chỉ nhận mặt trước hướng về phía camera)
  findHitFace(clientX, clientY) {
    if (!this.currentBrush) return null;
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const screenPanels = (this.projectionScreens && this.projectionScreens.getScreenPanels)
      ? this.projectionScreens.getScreenPanels()
      : [];
    const screenHits = (screenPanels.length > 0) ? this.raycaster.intersectObjects(screenPanels, false) : [];

    const hits = this.raycaster.intersectObject(this.currentBrush, false);
    if (hits.length === 0) return null;

    // Nếu màn chiếu ở phía trước khối 3D, không cho chọn mặt khối xuyên qua màn chiếu
    if (screenHits.length > 0 && screenHits[0].distance < hits[0].distance) {
      return null;
    }

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    // Chỉ chọn mặt trước hướng về camera
    let frontHit = null;
    for (const h of hits) {
      const norm = h.face.normal.clone().transformDirection(this.currentBrush.matrixWorld).normalize();
      if (norm.dot(camDir) < -0.01) {
        frontHit = h;
        break;
      }
    }
    if (!frontHit) return null;

    const triIdx = frontHit.faceIndex;
    if (triIdx !== undefined && this.triangleToFaceMap && this.triangleToFaceMap[triIdx] !== undefined) {
      const faceIdx = this.triangleToFaceMap[triIdx];
      return this.facesList[faceIdx] || null;
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
        // Highlight toàn bộ cạnh dài liền mạch: Vàng neon sáng
        this.previewGroup.add(this.createEdgeHighlight(edge.p1, edge.p2, 0xfbbf24, 4.5));
      } else {
        this.renderer.domElement.style.cursor = 'grab';
      }

      // Giữ highlight cho Cạnh 1 đã chọn: Xanh lục
      if (this.selectedEdge1) {
        this.previewGroup.add(this.createEdgeHighlight(this.selectedEdge1.p1, this.selectedEdge1.p2, 0x10b981, 4.5));
      }

    } else if (this.subMode === 'angle-faces') {
      const face = this.findHitFace(e.clientX, e.clientY);
      this.hoveredFace = face;
      if (face) {
        this.renderer.domElement.style.cursor = 'pointer';
        // Highlight chính xác duy nhất mặt phẳng đang hover: Xanh cyan mờ
        this.previewGroup.add(this.createFaceHighlight(face, 0x38bdf8, 0.45));
      } else {
        this.renderer.domElement.style.cursor = 'grab';
      }

      // Giữ highlight cho Mặt 1 đã chọn: Xanh lục
      if (this.selectedFace1) {
        this.previewGroup.add(this.createFaceHighlight(this.selectedFace1, 0x10b981, 0.55));
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
    if (this.selectedEdge1) {
      this.previewGroup.add(this.createEdgeHighlight(this.selectedEdge1.p1, this.selectedEdge1.p2, 0x10b981, 4.5));
    }
    if (this.selectedFace1) {
      this.previewGroup.add(this.createFaceHighlight(this.selectedFace1, 0x10b981, 0.35));
    }
    if (this.selectedPoint1) {
      this.previewGroup.add(this.createPointHighlight(this.selectedPoint1, 0x10b981));
    }
  }

  // ==========================================
  // CÁC HÀM TẠO SỐ ĐO KỸ THUẬT (MEASURE BUILDERS)
  // ==========================================

  // 1. Thêm số đo chiều dài cạnh (Edge Length)
  addMeasureEdge(edge) {
    const id = `edge_${this.idCounter++}`;
    const p1 = edge.p1.clone();
    const p2 = edge.p2.clone();
    const len3D = edge.len;

    // Tính hướng nhìn camera
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    // Vector nối 2 điểm cạnh
    const vEdge = new THREE.Vector3().subVectors(p2, p1);
    const vDotCam = vEdge.dot(camDir);
    // Vector hình chiếu phẳng vuông góc với hướng nhìn camera
    const vProj = new THREE.Vector3().subVectors(vEdge, camDir.clone().multiplyScalar(vDotCam));
    const len2D = vProj.length();

    // Nhận biết camera đang ở góc nhìn trực giao 2D (Chiếu Đứng, Chiếu Bằng, Chiếu Cạnh)
    const isOrthographicView = (this.camera.isOrthographicCamera) && (
      Math.abs(camDir.x) > 0.999 || Math.abs(camDir.y) > 0.999 || Math.abs(camDir.z) > 0.999
    );

    const isOblique = Math.abs(len3D - len2D) > 0.03;

    const fmt = (n) => (Math.abs(n - Math.round(n)) < 0.01) ? `${Math.round(n)}` : n.toFixed(2);

    let badgeText = '';
    let itemTitle = '';
    let itemSub = '';

    if (edge.isScreenEdge) {
      badgeText = `${fmt(len3D)}`;
      itemTitle = `Cạnh [Màn ${edge.screenName}]: ${fmt(len3D)}`;
      itemSub = `Đo trực tiếp trên Màn Chiếu ${edge.screenName} | Chiều dài: ${fmt(len3D)}`;
    } else if (isOrthographicView) {
      // Khi đang xem ở góc chiếu 2D
      if (isOblique) {
        badgeText = `${fmt(len2D)} (${fmt(len3D)})`;
        itemTitle = `Cạnh: ${fmt(len2D)} (Chiếu 2D)`;
        itemSub = `Hình chiếu: ${fmt(len2D)} | 3D thực: ${fmt(len3D)} (ΔX:${Math.abs(p2.x - p1.x).toFixed(1)}, ΔY:${Math.abs(p2.y - p1.y).toFixed(1)}, ΔZ:${Math.abs(p2.z - p1.z).toFixed(1)})`;
      } else {
        badgeText = `${fmt(len3D)}`;
        itemTitle = `Cạnh: ${fmt(len3D)}`;
        itemSub = `P1(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)}, ${p1.z.toFixed(1)}) ➔ P2(${p2.x.toFixed(1)}, ${p2.y.toFixed(1)}, ${p2.z.toFixed(1)})`;
      }
    } else {
      // Khi đang ở Trục đo 3D (ISO)
      if (isOblique) {
        badgeText = `${fmt(len3D)}`;
        itemTitle = `Cạnh: ${fmt(len3D)}`;
        itemSub = `Không gian 3D: ${fmt(len3D)} (ΔX:${Math.abs(p2.x - p1.x).toFixed(1)}, ΔY:${Math.abs(p2.y - p1.y).toFixed(1)}, ΔZ:${Math.abs(p2.z - p1.z).toFixed(1)})`;
      } else {
        badgeText = `${fmt(len3D)}`;
        itemTitle = `Cạnh: ${fmt(len3D)}`;
        itemSub = `P1(${p1.x.toFixed(1)}, ${p1.y.toFixed(1)}, ${p1.z.toFixed(1)}) ➔ P2(${p2.x.toFixed(1)}, ${p2.y.toFixed(1)}, ${p2.z.toFixed(1)})`;
      }
    }

    const group = new THREE.Group();
    group.name = id;

    // Đường viền sáng trên toàn bộ cạnh
    group.add(this.createEdgeHighlight(p1, p2, 0x38bdf8, 3.5));

    // Điểm đầu và cuối cạnh
    group.add(this.createPointHighlight(p1, 0x38bdf8, 0.08));
    group.add(this.createPointHighlight(p2, 0x38bdf8, 0.08));

    // Tính hướng gióng kích thước ra ngoài khối
    let perp;
    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const boxCenter = new THREE.Vector3(3, 2, 2);
    const outVec = new THREE.Vector3().subVectors(mid, boxCenter);

    if (isOrthographicView && vProj.length() > 0.01) {
      // Ép perp nằm phẳng 100% trên mặt phẳng chiếu vuông góc với camDir để không bị lệch góc
      outVec.sub(camDir.clone().multiplyScalar(outVec.dot(camDir)));
      const vProjDir = vProj.clone().normalize();
      perp = new THREE.Vector3().subVectors(outVec, vProjDir.clone().multiplyScalar(outVec.dot(vProjDir)));
      perp.sub(camDir.clone().multiplyScalar(perp.dot(camDir)));
      if (perp.length() < 0.01) {
        perp.crossVectors(camDir, vProjDir);
      }
      perp.normalize();
    } else {
      const edgeDir = new THREE.Vector3().subVectors(p2, p1).normalize();
      perp = new THREE.Vector3().subVectors(outVec, edgeDir.clone().multiplyScalar(outVec.dot(edgeDir)));
      if (perp.length() < 0.01) perp.set(0, 1, 0);
      perp.normalize();
    }

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
    const extMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.8, depthTest: true });
    const extLines = new THREE.LineSegments(extGeom, extMat);
    extLines.renderOrder = 1022;
    group.add(extLines);

    // Đường kích thước chính + 2 Mũi tên CAD
    const mainPts = [dStart.x, dStart.y, dStart.z, dEnd.x, dEnd.y, dEnd.z];
    this.addCadArrowTip(mainPts, dStart, dEnd, perp, 0.22, 0.08);
    this.addCadArrowTip(mainPts, dEnd, dStart, perp, 0.22, 0.08);

    const mainGeom = new THREE.BufferGeometry();
    mainGeom.setAttribute('position', new THREE.Float32BufferAttribute(mainPts, 3));
    const mainMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, depthTest: true });
    const mainLine = new THREE.LineSegments(mainGeom, mainMat);
    mainLine.renderOrder = 1024;
    group.add(mainLine);

    // Nhãn số đo sắc nét
    const dimMid = new THREE.Vector3().addVectors(dStart, dEnd).multiplyScalar(0.5);
    const sprite = this.createTextSprite(badgeText, '#38bdf8');
    sprite.position.copy(dimMid);
    group.add(sprite);

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'edge',
      title: itemTitle,
      sub: itemSub,
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

    // Highlight 2 cạnh: Cạnh 1 xanh lục, Cạnh 2 cam
    group.add(this.createEdgeHighlight(edge1.p1, edge1.p2, 0x10b981, 3.5));
    group.add(this.createEdgeHighlight(edge2.p1, edge2.p2, 0xf59e0b, 3.5));

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
      // 2 CẠNH CHUNG ĐỈNH: Vẽ cung tròn đo góc 3D
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
        const arcMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, linewidth: 2, depthTest: true });
        const arcLine = new THREE.Line(arcGeom, arcMat);
        arcLine.renderOrder = 1026;
        group.add(arcLine);

        const midRad = angleRad / 2;
        const labelPos = V.clone()
          .addScaledVector(dir1, Math.cos(midRad) * (R + 0.4))
          .addScaledVector(perp1, Math.sin(midRad) * (R + 0.4));

        const sprite = this.createTextSprite(`${angleDeg.toFixed(1)}°`, '#fbbf24');
        sprite.position.copy(labelPos);
        group.add(sprite);
      } else {
        const sprite = this.createTextSprite(`${angleDeg.toFixed(1)}°`, '#fbbf24');
        sprite.position.copy(V.clone().add(new THREE.Vector3(0, 0.4, 0)));
        group.add(sprite);
      }

    } else {
      // 2 CẠNH KHÔNG CHUNG ĐỈNH: Tính góc không gian giữa 2 vector
      const d1 = edge1.dir;
      const d2 = edge2.dir;
      const cosVal = Math.abs(d1.dot(d2));
      angleDeg = (Math.acos(Math.max(0, Math.min(1, cosVal))) * 180) / Math.PI;

      const linePts = [edge1.mid.x, edge1.mid.y, edge1.mid.z, edge2.mid.x, edge2.mid.y, edge2.mid.z];
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
      const mat = new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 0.2, gapSize: 0.1, depthTest: true });
      const line = new THREE.LineSegments(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 1024;
      group.add(line);

      const midMid = new THREE.Vector3().addVectors(edge1.mid, edge2.mid).multiplyScalar(0.5);
      const sprite = this.createTextSprite(`${angleDeg.toFixed(1)}°`, '#fbbf24');
      sprite.position.copy(midMid);
      group.add(sprite);
    }

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'angle-edges',
      title: `Góc 2 Cạnh: ${angleDeg.toFixed(1)}°`,
      sub: V ? `Chung đỉnh tại (${V.x.toFixed(1)}, ${V.y.toFixed(1)}, ${V.z.toFixed(1)})` : `2 cạnh song song / chéo`,
      group
    };

    this.measurements.push(item);
    this.updateUIList();
  }

  // 3. Thêm số đo góc giữa 2 mặt phẳng (Dihedral Angle)
  addMeasureAngleFaces(face1, face2) {
    const id = `angle_face_${this.idCounter++}`;
    const group = new THREE.Group();
    group.name = id;

    // Highlight 2 mặt phẳng được chọn
    group.add(this.createFaceHighlight(face1, 0x10b981, 0.5));
    group.add(this.createFaceHighlight(face2, 0xf59e0b, 0.5));

    // Tính góc giữa 2 pháp tuyến
    const dot = Math.max(-1, Math.min(1, face1.norm.dot(face2.norm)));
    const normAngleRad = Math.acos(dot);
    const normAngleDeg = (normAngleRad * 180) / Math.PI;

    // Góc nhị diện giữa 2 mặt trên tổng 360° (1 góc rộng + 1 góc hẹp)
    const interiorDeg = 180 - normAngleDeg;
    const exteriorDeg = 360 - interiorDeg;
    const wideDeg = Math.max(interiorDeg, exteriorDeg);
    const narrowDeg = Math.min(interiorDeg, exteriorDeg);

    const badgeText = `${wideDeg.toFixed(1)}° (${narrowDeg.toFixed(1)}°)`;
    let titleStr = '';
    let subStr = '';

    if (Math.abs(dot) < 0.01) {
      titleStr = `270.0° (90.0°)`;
      subStr = 'Góc rộng: 270.0° | Góc hẹp: 90.0° (Vuông góc)';
    } else {
      titleStr = badgeText;
      subStr = `Góc rộng: ${wideDeg.toFixed(1)}° | Góc hẹp: ${narrowDeg.toFixed(1)}° (Tổng 360°)`;
    }

    // Đặt nhãn tại vị trí trung gian giữa 2 mặt phẳng và đẩy nhẹ ra ngoài theo pháp tuyến chung để không bị lún vào khối khi bật depthTest
    const midPos = new THREE.Vector3().addVectors(face1.centroid, face2.centroid).multiplyScalar(0.5);
    const outNorm = new THREE.Vector3().addVectors(face1.norm, face2.norm);
    if (outNorm.lengthSq() > 0.001) {
      outNorm.normalize();
    } else {
      outNorm.copy(face1.norm);
    }
    midPos.addScaledVector(outNorm, 0.45);
    const sprite = this.createTextSprite(badgeText, '#a855f7');
    sprite.position.copy(midPos);
    group.add(sprite);

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'angle-faces',
      title: titleStr,
      sub: subStr,
      group
    };

    this.measurements.push(item);
    this.updateUIList();
  }

  // 4. Thêm số đo khoảng cách giữa 2 điểm (Distance)
  addMeasureDistance(p1, p2) {
    const id = `dist_${this.idCounter++}`;
    const group = new THREE.Group();
    group.name = id;

    const dist3D = p1.distanceTo(p2);
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    const dz = Math.abs(p2.z - p1.z);

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    const vDiff = new THREE.Vector3().subVectors(p2, p1);
    const vDotCam = vDiff.dot(camDir);
    const vProj = new THREE.Vector3().subVectors(vDiff, camDir.clone().multiplyScalar(vDotCam));
    const dist2D = vProj.length();

    const isOrthographicView = (this.camera.isOrthographicCamera) && (
      Math.abs(camDir.x) > 0.999 || Math.abs(camDir.y) > 0.999 || Math.abs(camDir.z) > 0.999
    );
    const isOblique = Math.abs(dist3D - dist2D) > 0.03;
    const fmt = (n) => (Math.abs(n - Math.round(n)) < 0.01) ? `${Math.round(n)}` : n.toFixed(2);

    let badgeText = `${fmt(dist3D)}`;
    let itemTitle = `Khoảng cách: ${fmt(dist3D)}`;
    let itemSub = `ΔX: ${dx.toFixed(1)} | ΔY: ${dy.toFixed(1)} | ΔZ: ${dz.toFixed(1)}`;

    if (isOrthographicView && isOblique) {
      badgeText = `${fmt(dist2D)} (${fmt(dist3D)})`;
      itemTitle = `Khoảng cách: ${fmt(dist2D)} (Chiếu 2D)`;
      itemSub = `Chiếu 2D: ${fmt(dist2D)} | 3D thực: ${fmt(dist3D)} (ΔX:${dx.toFixed(1)}, ΔY:${dy.toFixed(1)}, ΔZ:${dz.toFixed(1)})`;
    }

    group.add(this.createPointHighlight(p1, 0xec4899, 0.08));
    group.add(this.createPointHighlight(p2, 0xec4899, 0.08));

    const linePts = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xec4899, linewidth: 2.5, depthTest: true });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 1024;
    group.add(line);

    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const sprite = this.createTextSprite(badgeText, '#ec4899');
    sprite.position.copy(mid);
    group.add(sprite);

    this.measurementsGroup.add(group);

    const item = {
      id,
      type: 'distance',
      title: itemTitle,
      sub: itemSub,
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

  // Sao chép kết quả ra Clipboard
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
          found.group.scale.set(1.04, 1.04, 1.04);
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

  // Highlight một đoạn thẳng cạnh: Dạng ống trụ 3D phát sáng rõ nét, to đẹp mắt
  createEdgeHighlight(p1, p2, colorHex = 0xfbbf24, size = 0.045) {
    const radius = (typeof size === 'number' && size > 0.5) ? 0.045 : (size || 0.045);
    const group = new THREE.Group();
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    if (len < 0.001) return group;

    // 1. Thân ống trụ 3D nổi bật, dày dặn
    const cylGeom = new THREE.CylinderGeometry(radius, radius, len, 12, 1, false);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });
    const cyl = new THREE.Mesh(cylGeom, mat);

    const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    cyl.position.copy(mid);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    cyl.renderOrder = 1030;
    group.add(cyl);

    // 2. Hai chỏm cầu tròn tại 2 đỉnh đầu mút của cạnh
    const sphereGeom = new THREE.SphereGeometry(radius * 1.55, 12, 12);
    const s1 = new THREE.Mesh(sphereGeom, mat);
    s1.position.copy(p1);
    s1.renderOrder = 1031;
    group.add(s1);

    const s2 = new THREE.Mesh(sphereGeom, mat);
    s2.position.copy(p2);
    s2.renderOrder = 1031;
    group.add(s2);

    // 3. Đường chỉ sáng trắng ở trung tâm
    const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });
    const coreLine = new THREE.Line(lineGeom, lineMat);
    coreLine.renderOrder = 1032;
    group.add(coreLine);

    return group;
  }

  // Highlight một điểm (Sphere marker): 3 tầng hào quang rực rỡ, to rõ
  createPointHighlight(p, colorHex = 0xfbbf24, size = 0.13) {
    const radius = (typeof size === 'number' && size < 0.09) ? 0.13 : (size || 0.13);
    const group = new THREE.Group();

    // 1. Quả cầu tâm sáng đậm màu
    const coreGeom = new THREE.SphereGeometry(radius, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: true,
      depthWrite: false
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.position.copy(p);
    core.renderOrder = 1033;
    group.add(core);

    // 2. Vòng hào quang lớn bao quanh dạng wireframe
    const haloGeom = new THREE.SphereGeometry(radius * 1.9, 14, 14);
    const haloMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.45,
      wireframe: true,
      depthTest: true,
      depthWrite: false
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    halo.position.copy(p);
    halo.renderOrder = 1034;
    group.add(halo);

    // 3. Điểm tâm trắng phản chiếu
    const sparkGeom = new THREE.SphereGeometry(radius * 0.42, 8, 8);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      depthWrite: false
    });
    const spark = new THREE.Mesh(sparkGeom, sparkMat);
    spark.position.copy(p);
    spark.renderOrder = 1035;
    group.add(spark);

    return group;
  }

  // Highlight một mặt phẳng (Solid translucent glowing surface, không nét chéo tam giác, không nét dư)
  createFaceHighlight(face, colorHex = 0x38bdf8, opacity = 0.55) {
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
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.addScaledVector(face.norm, 0.008);
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

  // Tạo sprite nhãn số đo sắc nét, to đẹp từ 2D Canvas
  createTextSprite(text, borderColor = '#38bdf8', bgColor = 'rgba(15, 23, 42, 0.95)') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = 2;
    canvas.width = 280 * dpr;
    canvas.height = 76 * dpr;
    ctx.scale(dpr, dpr);

    const w = 280, h = 76;
    const boxW = 220, boxH = 46;
    const x = (w - boxW) / 2;
    const y = (h - boxH) / 2;

    ctx.shadowColor = borderColor;
    ctx.shadowBlur = 10;
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: true,
      depthWrite: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1040;
    sprite.scale.set(1.65, 0.45, 1);
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
