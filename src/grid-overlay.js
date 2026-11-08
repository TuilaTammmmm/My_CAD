import * as THREE from 'three';

export class GridOverlay {
  constructor(scene) {
    this.scene = scene;
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    // Mũi tên FRONT hiển thị độc lập
    this.arrowGroup = new THREE.Group();
    this.scene.add(this.arrowGroup);

    // Floor grid
    this.floorGrid = new THREE.GridHelper(40, 40, 0x0284c7, 0x334155);
    this.floorGrid.position.y = -0.01;
    this.scene.add(this.floorGrid);
  }

  setVisible(visible) {
    this.gridGroup.visible = visible;
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

    // KHÔNG VẼ KHUNG HỘP PHÔI LƠ LỬNG NGOÀI KHÔNG KHÍ (Bỏ nét ngoài theo yêu cầu)
    // Thay vào đó: VẼ ĐƯỜNG LƯỚI BÁM SÁT 100% VÀO BỀ MẶT THỰC CỦA KHỐI VỚI MÀU ĐẬM RÕ NÉT
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.55 // Màu đậm rõ nét
    });
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

      // Nhóm tam giác thành các mặt phẳng
      const faces = [];
      for (const t of triangles) {
        let f = faces.find(item => item.norm.dot(t.norm) > 0.99 && Math.abs(item.norm.dot(t.p0.clone().sub(item.p0))) < 0.01);
        if (f) f.triangles.push(t);
        else faces.push({ norm: t.norm, p0: t.p0, triangles: [t] });
      }

      for (const face of faces) {
        const N = face.norm;
        const absX = Math.abs(N.x), absY = Math.abs(N.y), absZ = Math.abs(N.z);

        // Kẻ các đường lưới ngang và dọc trên từng mặt (kể cả mặt nghiêng)
        if (absZ >= 0.3) {
          // Mặt chiếu Z: Kẻ các đường ngang Y = const và đường đứng X = const
          for (let y = 0; y <= h; y++) {
            const rowPts = [];
            for (let x = 0; x <= w; x++) {
              const z = face.p0.z - (N.x * (x - face.p0.x) + N.y * (y - face.p0.y)) / N.z;
              const pt = new THREE.Vector3(x, y, z);
              if (face.triangles.some(t => isPointInTriangle(pt, t))) {
                rowPts.push(pt);
              }
            }
            for (let i = 0; i < rowPts.length - 1; i++) {
              if (Math.abs(rowPts[i+1].x - rowPts[i].x) < 1.05) {
                linePoints.push(rowPts[i].x, rowPts[i].y, rowPts[i].z, rowPts[i+1].x, rowPts[i+1].y, rowPts[i+1].z);
              }
            }
          }
          for (let x = 0; x <= w; x++) {
            const colPts = [];
            for (let y = 0; y <= h; y++) {
              const z = face.p0.z - (N.x * (x - face.p0.x) + N.y * (y - face.p0.y)) / N.z;
              const pt = new THREE.Vector3(x, y, z);
              if (face.triangles.some(t => isPointInTriangle(pt, t))) {
                colPts.push(pt);
              }
            }
            for (let i = 0; i < colPts.length - 1; i++) {
              if (Math.abs(colPts[i+1].y - colPts[i].y) < 1.05) {
                linePoints.push(colPts[i].x, colPts[i].y, colPts[i].z, colPts[i+1].x, colPts[i+1].y, colPts[i+1].z);
              }
            }
          }
        } else if (absX >= 0.3) {
          // Mặt chiếu X
          for (let y = 0; y <= h; y++) {
            const rowPts = [];
            for (let z = 0; z <= d; z++) {
              const x = face.p0.x - (N.y * (y - face.p0.y) + N.z * (z - face.p0.z)) / N.x;
              const pt = new THREE.Vector3(x, y, z);
              if (face.triangles.some(t => isPointInTriangle(pt, t))) rowPts.push(pt);
            }
            for (let i = 0; i < rowPts.length - 1; i++) {
              if (Math.abs(rowPts[i+1].z - rowPts[i].z) < 1.05) {
                linePoints.push(rowPts[i].x, rowPts[i].y, rowPts[i].z, rowPts[i+1].x, rowPts[i+1].y, rowPts[i+1].z);
              }
            }
          }
          for (let z = 0; z <= d; z++) {
            const colPts = [];
            for (let y = 0; y <= h; y++) {
              const x = face.p0.x - (N.y * (y - face.p0.y) + N.z * (z - face.p0.z)) / N.x;
              const pt = new THREE.Vector3(x, y, z);
              if (face.triangles.some(t => isPointInTriangle(pt, t))) colPts.push(pt);
            }
            for (let i = 0; i < colPts.length - 1; i++) {
              if (Math.abs(colPts[i+1].y - colPts[i].y) < 1.05) {
                linePoints.push(colPts[i].x, colPts[i].y, colPts[i].z, colPts[i+1].x, colPts[i+1].y, colPts[i+1].z);
              }
            }
          }
        }
      }

      function isPointInTriangle(P, t) {
        const dist = Math.abs(t.norm.dot(P.clone().sub(t.p0)));
        if (dist > 0.02) return false;
        const edge0 = new THREE.Vector3().subVectors(t.p1, t.p0);
        const edge1 = new THREE.Vector3().subVectors(t.p2, t.p1);
        const edge2 = new THREE.Vector3().subVectors(t.p0, t.p2);
        const c0 = new THREE.Vector3().subVectors(P, t.p0).cross(edge0);
        const c1 = new THREE.Vector3().subVectors(P, t.p1).cross(edge1);
        const c2 = new THREE.Vector3().subVectors(P, t.p2).cross(edge2);
        const d0 = c0.dot(t.norm), d1 = c1.dot(t.norm), d2 = c2.dot(t.norm);
        return (d0 <= 0.02 && d1 <= 0.02 && d2 <= 0.02) || (d0 >= -0.02 && d1 >= -0.02 && d2 >= -0.02);
      }

    } else {
      // Fallback
      for (let x = 0; x <= w; x++) {
        linePoints.push(x, 0, d, x, h, d);
      }
      for (let y = 0; y <= h; y++) {
        linePoints.push(0, y, d, w, y, d);
      }
    }

    if (linePoints.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
      const subGridLines = new THREE.LineSegments(gridGeom, lineMat);
      this.gridGroup.add(subGridLines);
    }

    // 3. Mũi tên FRONT (Mặt trước)
    const arrowDir = new THREE.Vector3(0, 0, -1);
    const arrowOrigin = new THREE.Vector3(w / 2, 0.1, d + 3.2);
    const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 2.5, 0x38bdf8, 0.7, 0.4);
    this.arrowGroup.add(arrowHelper);
  }
}
