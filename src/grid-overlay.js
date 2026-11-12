import * as THREE from 'three';

/**
 * GridOverlay
 * Quản lý lưới ô vuông kỹ thuật theo đúng đề bài SGK và chuẩn bản vẽ CAD:
 * - Lưới sàn đáy (Floor grid): Hiển thị trong chế độ 3D Trục Đo, tự động ẩn trong các góc chiếu 2D (Đứng, Cạnh, Bằng) để bản vẽ trong trẻo, tinh gọn
 * - Mũi tên FRONT (Mặt trước): Hiển thị trong 3D Trục Đo, tự động ẩn trong góc chiếu 2D
 * - Lưới Ô Vuông của hộp phôi ban đầu (W x H x D) chia đều 1x1x1 (theo đúng đề bài SGK):
 *   + Ở các góc chiếu kỹ thuật (Đứng, Cạnh, Bằng): Hiển thị lưới phẳng 2D bao trùm toàn bộ diện tích hộp phôi ban đầu (cả vùng thịt lẫn vùng đã bị cắt gọt) giúp đếm ô cực kỳ trực quan
 *   + Ở Phối cảnh Trục đo 3D: Hiển thị lưới ô vuông trên cả 6 mặt ngoài của khối hộp
 * - Bật / Tắt ô vuông linh hoạt ở MỌI chế độ (kể cả Chỉ Xem và Cắt Gọt)
 */
export class GridOverlay {
  constructor(scene) {
    this.scene = scene;

    this.w = 6;
    this.h = 4;
    this.d = 4;
    this.currentView = 'iso';

    // Nhóm lưới ô vuông hộp ban đầu (bật/tắt được)
    this.gridGroup = new THREE.Group();
    this.gridGroup.renderOrder = 998;
    this.scene.add(this.gridGroup);

    // Mũi tên FRONT hiển thị trong chế độ Trục đo
    this.arrowGroup = new THREE.Group();
    this.arrowGroup.renderOrder = 996;
    this.scene.add(this.arrowGroup);

    // Lưới sàn đáy (Floor grid)
    this.floorGrid = new THREE.GridHelper(40, 40, 0x0284c7, 0x1e293b);
    this.floorGrid.position.y = -0.01;
    this.scene.add(this.floorGrid);

    // Trạng thái bật/tắt ô vuông (mặc định BẬT)
    this.showGridSquares = true;

    // Vật liệu đường lưới ô vuông bên trong: xanh cyan kỹ thuật
    this.innerGridMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.65,
      depthTest: false,
      depthWrite: false
    });

    // Đường viền khung bao hộp ngoài: xanh cyan đậm hơn, sắc nét
    this.boxBorderMat = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });

    // Vật liệu 3D khi xem Trục Đo (có depthTest để nhìn thấy chiều sâu)
    this.isoGridMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.5,
      depthTest: true
    });

    this.isoBorderMat = new THREE.LineBasicMaterial({
      color: 0x0284c7,
      transparent: true,
      opacity: 0.75,
      depthTest: true
    });
  }

  // Chuyển góc nhìn (iso, front, right, back, left, top)
  setView(viewName) {
    this.currentView = viewName;
    this.rebuild();
  }

  // Chuyển chế độ thao tác: Giữ nguyên trạng thái bật/tắt ô vuông của người dùng
  setVisible(isEditing) {
    this.updateVisibility();
  }

  // Ẩn/Hiện toàn bộ (ví dụ khi sang 2D CAD Editor)
  setAllVisible(visible) {
    this.gridGroup.visible = visible && this.showGridSquares;
    this.arrowGroup.visible = visible && (this.currentView === 'iso');
    this.floorGrid.visible = visible && (this.currentView === 'iso');
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

  getDisplayStep(maxDim) {
    if (maxDim <= 16) return 1;
    if (maxDim <= 40) return 2;
    if (maxDim <= 80) return 5;
    if (maxDim <= 160) return 10;
    if (maxDim <= 320) return 20;
    return 50;
  }

  // Cập nhật kích thước lưới theo kích thước hộp ban đầu W x H x D
  update(w, h, d, brush = null, snapStep = 1.0) {
    this.w = w;
    this.h = h;
    this.d = d;
    const maxDim = Math.max(w, h, d);
    const step = this.getDisplayStep(maxDim);
    const desiredSize = Math.max(40, Math.ceil((maxDim * 2.5) / (step * 4)) * (step * 4));
    const divisions = Math.max(10, Math.min(48, Math.round(desiredSize / step)));

    if (!this._floorSpan || this._floorSpan !== desiredSize || this._floorDiv !== divisions) {
      if (this.floorGrid) {
        this.scene.remove(this.floorGrid);
        this.floorGrid.geometry.dispose();
        if (Array.isArray(this.floorGrid.material)) {
          this.floorGrid.material.forEach(m => m.dispose());
        } else if (this.floorGrid.material) {
          this.floorGrid.material.dispose();
        }
      }
      this.floorGrid = new THREE.GridHelper(desiredSize, divisions, 0x0284c7, 0x1e293b);
      this.scene.add(this.floorGrid);
      this._floorSpan = desiredSize;
      this._floorDiv = divisions;
    }

    this.floorGrid.position.set(w / 2, -0.01, d / 2);
    this.rebuild();
  }

  rebuild() {
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

    const { w, h, d } = this;
    const view = this.currentView;

    // 1. Điều khiển Sàn và Mũi tên: Chỉ hiện ở Trục đo 3D (ISO) để bản vẽ 2D hoàn toàn tinh gọn
    const isIso = (view === 'iso');
    this.floorGrid.visible = isIso;
    this.arrowGroup.visible = isIso;

    if (isIso) {
      // Mũi tên FRONT chỉ trong Trục Đo
      const k = Math.max(1, Math.max(w, h, d) / 12);
      const arrowDir = new THREE.Vector3(0, 0, -1);
      const arrowOrigin = new THREE.Vector3(w / 2, 0.1, d + 3.2 * k);
      const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 2.5 * k, 0x38bdf8, 0.7 * k, 0.4 * k);
      arrowHelper.renderOrder = 996;
      this.arrowGroup.add(arrowHelper);

      // Lưới 3D cả 6 mặt khối hộp
      this.build3DBoxGrid(w, h, d);
    } else {
      // Góc chiếu kỹ thuật 2D: Chiếu đứng, Cạnh, Bằng
      this.build2DProjectedGrid(view, w, h, d);
    }

    this.updateVisibility();
  }

  // Xây dựng lưới 2D chuẩn xác theo góc chiếu kỹ thuật
  build2DProjectedGrid(view, w, h, d) {
    const innerPts = [];
    const borderPts = [];
    const step = this.getDisplayStep(Math.max(w, h, d));

    if (view === 'front') {
      // HÌNH CHIẾU ĐỨNG: Khung W x H tại mặt trước Z = D
      const zPlane = d + 0.005;

      // Đường kẻ ô bên trong
      for (let x = step; x < w; x += step) {
        innerPts.push(x, 0, zPlane, x, h, zPlane);
      }
      for (let y = step; y < h; y += step) {
        innerPts.push(0, y, zPlane, w, y, zPlane);
      }

      // Khung viền ngoài chữ nhật W x H
      borderPts.push(
        0, 0, zPlane, w, 0, zPlane,
        w, 0, zPlane, w, h, zPlane,
        w, h, zPlane, 0, h, zPlane,
        0, h, zPlane, 0, 0, zPlane
      );

    } else if (view === 'back') {
      // HÌNH CHIẾU SAU: Khung W x H tại Z = 0
      const zPlane = -0.005;
      for (let x = step; x < w; x += step) {
        innerPts.push(x, 0, zPlane, x, h, zPlane);
      }
      for (let y = step; y < h; y += step) {
        innerPts.push(0, y, zPlane, w, y, zPlane);
      }
      borderPts.push(
        0, 0, zPlane, w, 0, zPlane,
        w, 0, zPlane, w, h, zPlane,
        w, h, zPlane, 0, h, zPlane,
        0, h, zPlane, 0, 0, zPlane
      );

    } else if (view === 'right') {
      // HÌNH CHIẾU CẠNH PHẢI: Khung D x H tại mặt X = W
      const xPlane = w + 0.005;
      for (let z = step; z < d; z += step) {
        innerPts.push(xPlane, 0, z, xPlane, h, z);
      }
      for (let y = step; y < h; y += step) {
        innerPts.push(xPlane, y, 0, xPlane, y, d);
      }
      borderPts.push(
        xPlane, 0, 0, xPlane, 0, d,
        xPlane, 0, d, xPlane, h, d,
        xPlane, h, d, xPlane, h, 0,
        xPlane, h, 0, xPlane, 0, 0
      );

    } else if (view === 'left') {
      // HÌNH CHIẾU CẠNH TRÁI: Khung D x H tại mặt X = 0
      const xPlane = -0.005;
      for (let z = step; z < d; z += step) {
        innerPts.push(xPlane, 0, z, xPlane, h, z);
      }
      for (let y = step; y < h; y += step) {
        innerPts.push(xPlane, y, 0, xPlane, y, d);
      }
      borderPts.push(
        xPlane, 0, 0, xPlane, 0, d,
        xPlane, 0, d, xPlane, h, d,
        xPlane, h, d, xPlane, h, 0,
        xPlane, h, 0, xPlane, 0, 0
      );

    } else if (view === 'top') {
      // HÌNH CHIẾU BẰNG: Khung W x D tại nắp trên Y = H
      const yPlane = h + 0.005;
      for (let x = step; x < w; x += step) {
        innerPts.push(x, yPlane, 0, x, yPlane, d);
      }
      for (let z = step; z < d; z += step) {
        innerPts.push(0, yPlane, z, w, yPlane, z);
      }
      borderPts.push(
        0, yPlane, 0, w, yPlane, 0,
        w, yPlane, 0, w, yPlane, d,
        w, yPlane, d, 0, yPlane, d,
        0, yPlane, d, 0, yPlane, 0
      );
    }

    if (innerPts.length > 0) {
      const gGeom = new THREE.BufferGeometry();
      gGeom.setAttribute('position', new THREE.Float32BufferAttribute(innerPts, 3));
      const gridLines = new THREE.LineSegments(gGeom, this.innerGridMat);
      gridLines.renderOrder = 998;
      this.gridGroup.add(gridLines);
    }

    if (borderPts.length > 0) {
      const bGeom = new THREE.BufferGeometry();
      bGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
      const borderLines = new THREE.LineSegments(bGeom, this.boxBorderMat);
      borderLines.renderOrder = 999;
      this.gridGroup.add(borderLines);
    }
  }

  // Xây dựng lưới 3D toàn bộ khối hộp ban đầu
  build3DBoxGrid(w, h, d) {
    const gridPts = [];
    const step = this.getDisplayStep(Math.max(w, h, d));

    // 1. Mặt Trước (Z = D) và Mặt Sau (Z = 0)
    for (let x = step; x < w; x += step) {
      gridPts.push(x, 0, d, x, h, d);
      gridPts.push(x, 0, 0, x, h, 0);
    }
    for (let y = step; y < h; y += step) {
      gridPts.push(0, y, d, w, y, d);
      gridPts.push(0, y, 0, w, y, 0);
    }

    // 2. Mặt Trái (X = 0) và Mặt Phải (X = W)
    for (let z = step; z < d; z += step) {
      gridPts.push(0, 0, z, 0, h, z);
      gridPts.push(w, 0, z, w, h, z);
    }
    for (let y = step; y < h; y += step) {
      gridPts.push(0, y, 0, 0, y, d);
      gridPts.push(w, y, 0, w, y, d);
    }

    // 3. Mặt Đáy (Y = 0) và Mặt Nắp Trên (Y = H)
    for (let x = step; x < w; x += step) {
      gridPts.push(x, 0, 0, x, 0, d);
      gridPts.push(x, h, 0, x, h, d);
    }
    for (let z = step; z < d; z += step) {
      gridPts.push(0, 0, z, w, 0, z);
      gridPts.push(0, h, z, w, h, z);
    }

    if (gridPts.length > 0) {
      const gGeom = new THREE.BufferGeometry();
      gGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridLines = new THREE.LineSegments(gGeom, this.isoGridMat);
      gridLines.renderOrder = 993;
      this.gridGroup.add(gridLines);
    }

    // Khung viền 12 cạnh của hộp phôi ban đầu
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
    const borderLines = new THREE.LineSegments(bGeom, this.isoBorderMat);
    borderLines.renderOrder = 994;
    this.gridGroup.add(borderLines);
  }
}
