import * as THREE from 'three';

export class GridOverlay {
  constructor(scene) {
    this.scene = scene;
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    // Nhóm riêng cho mũi tên FRONT để không bao giờ bị ẩn khi ở chế độ Chỉ Xem
    this.arrowGroup = new THREE.Group();
    this.scene.add(this.arrowGroup);

    // Floor grid
    this.floorGrid = new THREE.GridHelper(40, 40, 0x0284c7, 0x334155);
    this.floorGrid.position.y = -0.01;
    this.scene.add(this.floorGrid);
  }

  setVisible(visible) {
    this.gridGroup.visible = visible;
    // Mũi tên FRONT luôn hiển thị ở chế độ 3D (kể cả Chỉ Xem)
    this.arrowGroup.visible = true;
  }

  setAllVisible(visible) {
    this.gridGroup.visible = visible;
    this.arrowGroup.visible = visible;
    this.floorGrid.visible = visible;
  }

  update(w, h, d, brush = null) {
    this.floorGrid.position.set(w / 2, -0.01, d / 2);

    // Xóa các đường lưới cũ
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

    // 1. Khung hộp giới hạn (Bounding box phôi ban đầu dạng mờ tham chiếu)
    const boxGeom = new THREE.BoxGeometry(w, h, d);
    boxGeom.translate(w / 2, h / 2, d / 2);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);
    const boxLines = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.15 })
    );
    this.gridGroup.add(boxLines);

    // 2. CÁC ĐƯỜNG LƯỚI Ô KỸ THUẬT BÁM SÁT TRỰC TIẾP LÊN BỀ MẶT KHỐI
    const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28 });
    const linePoints = [];

    if (brush && brush.geometry) {
      const nonIndexed = brush.geometry.index ? brush.geometry.toNonIndexed() : brush.geometry;
      const pos = nonIndexed.attributes.position;
      const triCount = Math.floor(pos.count / 3);
      const triangles = [];
      for (let i = 0; i < triCount; i++) {
        const p0 = new THREE.Vector3(pos.getX(i*3), pos.getY(i*3), pos.getZ(i*3));
        const p1 = new THREE.Vector3(pos.getX(i*3+1), pos.getY(i*3+1), pos.getZ(i*3+1));
        const p2 = new THREE.Vector3(pos.getX(i*3+2), pos.getY(i*3+2), pos.getZ(i*3+2));
        const norm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
        const len = norm.length();
        if (len > 1e-6) triangles.push({ p0, p1, p2, norm: norm.normalize() });
      }

      function isPointOnSurface(P) {
        for (const t of triangles) {
          const distToPlane = Math.abs(t.norm.dot(P.clone().sub(t.p0)));
          if (distToPlane < 0.02) {
            const edge0 = new THREE.Vector3().subVectors(t.p1, t.p0);
            const edge1 = new THREE.Vector3().subVectors(t.p2, t.p1);
            const edge2 = new THREE.Vector3().subVectors(t.p0, t.p2);
            const c0 = new THREE.Vector3().subVectors(P, t.p0).cross(edge0);
            const c1 = new THREE.Vector3().subVectors(P, t.p1).cross(edge1);
            const c2 = new THREE.Vector3().subVectors(P, t.p2).cross(edge2);
            const d0 = c0.dot(t.norm), d1 = c1.dot(t.norm), d2 = c2.dot(t.norm);
            if ((d0 <= 0.02 && d1 <= 0.02 && d2 <= 0.02) || (d0 >= -0.02 && d1 >= -0.02 && d2 >= -0.02)) {
              return true;
            }
          }
        }
        return false;
      }

      const surfacePoints = new Set();
      for (let x = 0; x <= w; x++) {
        for (let y = 0; y <= h; y++) {
          for (let z = 0; z <= d; z++) {
            if (isPointOnSurface(new THREE.Vector3(x, y, z))) {
              surfacePoints.add(x + ',' + y + ',' + z);
            }
          }
        }
      }

      const tryAddSeg = (x1, y1, z1, x2, y2, z2) => {
        const mid = new THREE.Vector3((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
        if (isPointOnSurface(mid)) {
          linePoints.push(x1, y1, z1, x2, y2, z2);
        }
      };

      for (let x = 0; x <= w; x++) {
        for (let y = 0; y <= h; y++) {
          for (let z = 0; z <= d; z++) {
            if (!surfacePoints.has(x + ',' + y + ',' + z)) continue;
            if (x < w && surfacePoints.has((x + 1) + ',' + y + ',' + z)) tryAddSeg(x, y, z, x + 1, y, z);
            if (y < h && surfacePoints.has(x + ',' + (y + 1) + ',' + z)) tryAddSeg(x, y, z, x, y + 1, z);
            if (z < d && surfacePoints.has(x + ',' + y + ',' + (z + 1))) tryAddSeg(x, y, z, x, y, z + 1);
          }
        }
      }
    } else {
      // Fallback khi chưa có brush: vẽ lưới 3 mặt chính
      for (let x = 0; x <= w; x++) {
        linePoints.push(x, 0, 0, x, 0, d);
        linePoints.push(x, 0, d, x, h, d);
      }
      for (let y = 0; y <= h; y++) {
        linePoints.push(0, y, d, w, y, d);
        linePoints.push(w, y, 0, w, y, d);
      }
      for (let z = 0; z <= d; z++) {
        linePoints.push(0, 0, z, w, 0, z);
        linePoints.push(w, 0, z, w, h, z);
      }
    }

    if (linePoints.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
      const subGridLines = new THREE.LineSegments(gridGeom, lineMat);
      this.gridGroup.add(subGridLines);
    }

    // 3. Mũi tên FRONT (Mặt trước) chỉ thẳng vào mặt trước Z=d
    const arrowDir = new THREE.Vector3(0, 0, -1);
    const arrowOrigin = new THREE.Vector3(w / 2, 0.1, d + 3.2);
    const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 2.5, 0x38bdf8, 0.7, 0.4);
    this.arrowGroup.add(arrowHelper);
  }
}
