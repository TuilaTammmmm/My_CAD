import * as THREE from 'three';

/**
 * GridOverlay
 * Quản lý lưới ô vuông kỹ thuật 3D:
 * - Lưới sàn đáy (Floor grid)
 * - Mũi tên FRONT (Mặt trước)
 * - Lưới Ô Vuông bám sát trên bề mặt khối thực (Surface Grid Squares)
 * - Khung phôi ban đầu dạng ô vuông mờ (Phantom Bounding Grid - chuẩn đề bài vẽ kỹ thuật)
 * - Có thể BẬT / TẮT ô vuông linh hoạt khi không ở chế độ Chỉ Xem
 */
export class GridOverlay {
  constructor(scene) {
    this.scene = scene;

    // Nhóm lưới ô vuông trên khối (bật/tắt được)
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    // Mũi tên FRONT hiển thị độc lập (luôn hiện)
    this.arrowGroup = new THREE.Group();
    this.scene.add(this.arrowGroup);

    // Lưới sàn đáy (Floor grid)
    this.floorGrid = new THREE.GridHelper(40, 40, 0x0284c7, 0x1e293b);
    this.floorGrid.position.y = -0.01;
    this.scene.add(this.floorGrid);

    // Trạng thái bật/tắt ô vuông (mặc định BẬT khi cắt gọt)
    this.showGridSquares = true;
    this.isModeEditing = false; // true khi không ở 'view'

    // Vật liệu đường lưới ô vuông trên mặt khối (xanh ngọc kỹ thuật rõ nét)
    this.surfaceGridMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      depthTest: true
    });

    // Vật liệu khung phôi ban đầu mờ (Phantom wireframe như đề bài)
    this.phantomGridMat = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.22,
      depthTest: true
    });
  }

  // Bật/tắt hiển thị lưới khi chuyển chế độ (Chỉ Xem vs Cắt Gọt)
  setVisible(isEditing) {
    this.isModeEditing = isEditing;
    this.updateVisibility();
    this.arrowGroup.visible = true;
  }

  // Ẩn/Hiện toàn bộ (ví dụ khi sang 2D CAD)
  setAllVisible(visible) {
    this.gridGroup.visible = visible && this.isModeEditing && this.showGridSquares;
    this.arrowGroup.visible = visible;
    this.floorGrid.visible = visible;
  }

  // Người dùng chủ động Bật/Tắt Lưới Ô Vuông
  toggleGridSquares() {
    this.showGridSquares = !this.showGridSquares;
    this.updateVisibility();
    return this.showGridSquares;
  }

  setGridSquaresVisible(visible) {
    this.showGridSquares = visible;
    this.updateVisibility();
  }

  updateVisibility() {
    this.gridGroup.visible = this.isModeEditing && this.showGridSquares;
  }

  update(w, h, d, brush = null, snapStep = 1.0) {
    this.floorGrid.position.set(w / 2, -0.01, d / 2);

    // Xóa sạch lưới cũ
    while (this.gridGroup.children.length > 0) {
      const obj = this.gridGroup.children[0];
      this.gridGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    // Xóa mũi tên cũ
    while (this.arrowGroup.children.length > 0) {
      const obj = this.arrowGroup.children[0];
      this.arrowGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    // 1. TẠO LƯỚI KHUNG PHÔI BAN ĐẦU (PHANTOM BOUNDING GRID)
    // Giúp quan sát trực quan các ô vuông đã bị khoét/cắt đi (giống hình vẽ bài tập trong SGK)
    const phantomPts = [];
    // Các đường chia ô vuông theo X trên 4 mặt bao
    for (let x = 1; x < w; x++) {
      phantomPts.push(x, 0, 0, x, h, 0); // Mặt sau
      phantomPts.push(x, 0, d, x, h, d); // Mặt trước
      phantomPts.push(x, 0, 0, x, 0, d); // Đáy
      phantomPts.push(x, h, 0, x, h, d); // Nắp trên
    }
    // Các đường chia ô vuông theo Y
    for (let y = 1; y < h; y++) {
      phantomPts.push(0, y, 0, w, y, 0); // Mặt sau
      phantomPts.push(0, y, d, w, y, d); // Mặt trước
      phantomPts.push(0, y, 0, 0, y, d); // Mặt trái
      phantomPts.push(w, y, 0, w, y, d); // Mặt phải
    }
    // Các đường chia ô vuông theo Z
    for (let z = 1; z < d; z++) {
      phantomPts.push(0, 0, z, 0, h, z); // Mặt trái
      phantomPts.push(w, 0, z, w, h, z); // Mặt phải
      phantomPts.push(0, 0, z, w, 0, z); // Đáy
      phantomPts.push(0, h, z, w, h, z); // Nắp trên
    }

    if (phantomPts.length > 0) {
      const pGeom = new THREE.BufferGeometry();
      pGeom.setAttribute('position', new THREE.Float32BufferAttribute(phantomPts, 3));
      const phantomMesh = new THREE.LineSegments(pGeom, this.phantomGridMat);
      phantomMesh.renderOrder = 990;
      this.gridGroup.add(phantomMesh);
    }

    // 2. TẠO LƯỚI Ô VUÔNG BÁM SÁT TRÊN BỀ MẶT THỰC CỦA KHỐI (SURFACE GRID SQUARES)
    const surfacePts = [];

    if (brush && brush.geometry) {
      const nonIndexed = brush.geometry.index ? brush.geometry.toNonIndexed() : brush.geometry;
      const pos = nonIndexed.attributes.position;
      const triCount = Math.floor(pos.count / 3);
      const triangles = [];

      for (let i = 0; i < triCount; i++) {
        const p0 = new THREE.Vector3(pos.getX(i * 3), pos.getY(i * 3), pos.getZ(i * 3));
        const p1 = new THREE.Vector3(pos.getX(i * 3 + 1), pos.getY(i * 3 + 1), pos.getZ(i * 3 + 1));
        const p2 = new THREE.Vector3(pos.getX(i * 3 + 2), pos.getY(i * 3 + 2), pos.getZ(i * 3 + 2));
        const norm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
        const len = norm.length();
        if (len > 1e-6) {
          triangles.push({ p0, p1, p2, norm: norm.normalize() });
        }
      }

      // Hàm cắt 1 tam giác 3D bằng mặt phẳng toạ độ (X = val, Y = val, hoặc Z = val)
      const sliceTriWithPlane = (t, axis, val) => {
        const pts = [t.p0, t.p1, t.p2];
        const vA = pts[0][axis] - val;
        const vB = pts[1][axis] - val;
        const vC = pts[2][axis] - val;

        const intersections = [];
        const checkEdge = (pA, pB, d1, d2) => {
          if ((d1 < -1e-5 && d2 > 1e-5) || (d1 > 1e-5 && d2 < -1e-5)) {
            const frac = -d1 / (d2 - d1);
            if (frac >= 0 && frac <= 1) {
              intersections.push(new THREE.Vector3().lerpVectors(pA, pB, frac));
            }
          }
        };

        checkEdge(pts[0], pts[1], vA, vB);
        checkEdge(pts[1], pts[2], vB, vC);
        checkEdge(pts[2], pts[0], vC, vA);

        if (intersections.length === 2) {
          // Đẩy nhẹ theo pháp tuyến mặt tam giác để không bị chìm hay z-fight
          const offset = t.norm.clone().multiplyScalar(0.003);
          const i1 = intersections[0].add(offset);
          const i2 = intersections[1].add(offset);
          if (i1.distanceTo(i2) > 0.05) {
            surfacePts.push(i1.x, i1.y, i1.z, i2.x, i2.y, i2.z);
          }
        }
      };

      for (const t of triangles) {
        // Cắt theo các mặt X nguyên
        for (let x = 0; x <= w; x++) {
          const minX = Math.min(t.p0.x, t.p1.x, t.p2.x);
          const maxX = Math.max(t.p0.x, t.p1.x, t.p2.x);
          if (x > minX - 1e-4 && x < maxX + 1e-4 && Math.abs(t.norm.x) < 0.99) {
            sliceTriWithPlane(t, 'x', x);
          }
        }
        // Cắt theo các mặt Y nguyên
        for (let y = 0; y <= h; y++) {
          const minY = Math.min(t.p0.y, t.p1.y, t.p2.y);
          const maxY = Math.max(t.p0.y, t.p1.y, t.p2.y);
          if (y > minY - 1e-4 && y < maxY + 1e-4 && Math.abs(t.norm.y) < 0.99) {
            sliceTriWithPlane(t, 'y', y);
          }
        }
        // Cắt theo các mặt Z nguyên
        for (let z = 0; z <= d; z++) {
          const minZ = Math.min(t.p0.z, t.p1.z, t.p2.z);
          const maxZ = Math.max(t.p0.z, t.p1.z, t.p2.z);
          if (z > minZ - 1e-4 && z < maxZ + 1e-4 && Math.abs(t.norm.z) < 0.99) {
            sliceTriWithPlane(t, 'z', z);
          }
        }
      }
    }

    if (surfacePts.length > 0) {
      const sGeom = new THREE.BufferGeometry();
      sGeom.setAttribute('position', new THREE.Float32BufferAttribute(surfacePts, 3));
      const surfaceMesh = new THREE.LineSegments(sGeom, this.surfaceGridMat);
      surfaceMesh.renderOrder = 995;
      this.gridGroup.add(surfaceMesh);
    }

    // 3. Mũi tên FRONT (Mặt trước) chuẩn kỹ thuật
    const arrowDir = new THREE.Vector3(0, 0, -1);
    const arrowOrigin = new THREE.Vector3(w / 2, 0.1, d + 3.2);
    const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 2.5, 0x38bdf8, 0.7, 0.4);
    arrowHelper.renderOrder = 996;
    this.arrowGroup.add(arrowHelper);

    this.updateVisibility();
  }
}
