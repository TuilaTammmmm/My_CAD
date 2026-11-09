import * as THREE from 'three';

/**
 * GridOverlay
 * Quản lý lưới ô vuông kỹ thuật 3D:
 * - Lưới sàn đáy (Floor grid)
 * - Mũi tên FRONT (Mặt trước)
 * - Lưới Ô Vuông của hộp phôi ban đầu (W x H x D) chia đều 1x1x1 (theo đúng đề bài SGK)
 * - Bật / Tắt ô vuông linh hoạt ở MỌI chế độ (kể cả Chỉ Xem và Cắt Gọt)
 */
export class GridOverlay {
  constructor(scene) {
    this.scene = scene;

    // Nhóm lưới ô vuông hộp ban đầu (bật/tắt được)
    this.gridGroup = new THREE.Group();
    this.gridGroup.renderOrder = 992;
    this.scene.add(this.gridGroup);

    // Mũi tên FRONT hiển thị độc lập
    this.arrowGroup = new THREE.Group();
    this.arrowGroup.renderOrder = 996;
    this.scene.add(this.arrowGroup);

    // Lưới sàn đáy (Floor grid)
    this.floorGrid = new THREE.GridHelper(40, 40, 0x0284c7, 0x1e293b);
    this.floorGrid.position.y = -0.01;
    this.scene.add(this.floorGrid);

    // Trạng thái bật/tắt ô vuông (mặc định BẬT để tiện quan sát và đếm ô)
    this.showGridSquares = true;

    // Vật liệu đường lưới ô vuông hộp ban đầu (xanh cyan kỹ thuật, trong suốt vừa phải)
    this.boxGridMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.5,
      depthTest: true
    });

    // Đường viền khung bao hộp ngoài
    this.boxBorderMat = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.7,
      depthTest: true
    });
  }

  // Chuyển chế độ: Giữ nguyên trạng thái bật/tắt ô vuông của người dùng
  setVisible(isEditing) {
    this.updateVisibility();
    this.arrowGroup.visible = true;
  }

  // Ẩn/Hiện toàn bộ (ví dụ khi sang 2D CAD)
  setAllVisible(visible) {
    this.gridGroup.visible = visible && this.showGridSquares;
    this.arrowGroup.visible = visible;
    this.floorGrid.visible = visible;
  }

  // Người dùng chủ động Bật / Tắt Lưới Ô Vuông (hoạt động ở cả Chỉ Xem lẫn Cắt Gọt)
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
    this.gridGroup.visible = this.showGridSquares;
  }

  // Cập nhật kích thước lưới theo kích thước hộp ban đầu W x H x D
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

    // TẠO LƯỚI Ô VUÔNG THEO ĐÚNG HỘP PHÔI BAN ĐẦU (W x H x D)
    // Các đường kẻ ô vuông 1x1 trên toàn bộ các mặt bao quanh hộp phôi ban đầu
    const gridPts = [];

    // 1. Mặt Trước (Z = D) và Mặt Sau (Z = 0)
    for (let x = 1; x < w; x++) {
      gridPts.push(x, 0, d, x, h, d); // Đứng trước
      gridPts.push(x, 0, 0, x, h, 0); // Đứng sau
    }
    for (let y = 1; y < h; y++) {
      gridPts.push(0, y, d, w, y, d); // Ngang trước
      gridPts.push(0, y, 0, w, y, 0); // Ngang sau
    }

    // 2. Mặt Trái (X = 0) và Mặt Phải (X = W)
    for (let z = 1; z < d; z++) {
      gridPts.push(0, 0, z, 0, h, z); // Đứng trái
      gridPts.push(w, 0, z, w, h, z); // Đứng phải
    }
    for (let y = 1; y < h; y++) {
      gridPts.push(0, y, 0, 0, y, d); // Ngang trái
      gridPts.push(w, y, 0, w, y, d); // Ngang phải
    }

    // 3. Mặt Đáy (Y = 0) và Mặt Nắp Trên (Y = H)
    for (let x = 1; x < w; x++) {
      gridPts.push(x, 0, 0, x, 0, d); // Dọc đáy
      gridPts.push(x, h, 0, x, h, d); // Dọc nắp
    }
    for (let z = 1; z < d; z++) {
      gridPts.push(0, 0, z, w, 0, z); // Ngang đáy
      gridPts.push(0, h, z, w, h, z); // Ngang nắp
    }

    if (gridPts.length > 0) {
      const gGeom = new THREE.BufferGeometry();
      gGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridLines = new THREE.LineSegments(gGeom, this.boxGridMat);
      gridLines.renderOrder = 993;
      this.gridGroup.add(gridLines);
    }

    // 4. Khung viền 12 cạnh của hộp phôi ban đầu
    const borderPts = [
      // Đáy
      0, 0, 0, w, 0, 0,
      w, 0, 0, w, 0, d,
      w, 0, d, 0, 0, d,
      0, 0, d, 0, 0, 0,
      // Nắp
      0, h, 0, w, h, 0,
      w, h, 0, w, h, d,
      w, h, d, 0, h, d,
      0, h, d, 0, h, 0,
      // 4 cột đứng
      0, 0, 0, 0, h, 0,
      w, 0, 0, w, h, 0,
      w, 0, d, w, h, d,
      0, 0, d, 0, h, d
    ];
    const bGeom = new THREE.BufferGeometry();
    bGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    const borderLines = new THREE.LineSegments(bGeom, this.boxBorderMat);
    borderLines.renderOrder = 994;
    this.gridGroup.add(borderLines);

    // 5. Mũi tên FRONT (Mặt trước) chuẩn kỹ thuật
    const arrowDir = new THREE.Vector3(0, 0, -1);
    const arrowOrigin = new THREE.Vector3(w / 2, 0.1, d + 3.2);
    const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 2.5, 0x38bdf8, 0.7, 0.4);
    arrowHelper.renderOrder = 996;
    this.arrowGroup.add(arrowHelper);

    this.updateVisibility();
  }
}
