import * as THREE from 'three';

export class CutterPreview {
  constructor(scene) {
    this.scene = scene;
    this.previewMesh = null;
    this.previewEdges = null;

    this.material = new THREE.MeshBasicMaterial({
      color: 0xe11d48,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xff1744,
      linewidth: 2
    });
  }

  clear() {
    if (this.previewMesh) {
      this.scene.remove(this.previewMesh);
      if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
      this.previewMesh = null;
    }
    if (this.previewEdges) {
      this.scene.remove(this.previewEdges);
      if (this.previewEdges.geometry) this.previewEdges.geometry.dispose();
      this.previewEdges = null;
    }
  }

  setPreviewGeom(geom) {
    this.clear();
    this.previewMesh = new THREE.Mesh(geom, this.material);
    this.previewEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geom), this.edgeMaterial);
    this.scene.add(this.previewMesh);
    this.scene.add(this.previewEdges);
  }

  showBox(x1, x2, y1, y2, z1, z2) {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
    const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
    if (w <= 0.0001 || h <= 0.0001 || d <= 0.0001) {
      this.clear();
      return;
    }

    const geom = new THREE.BoxGeometry(w, h, d);
    geom.translate(minX + w / 2, minY + h / 2, minZ + d / 2);
    this.setPreviewGeom(geom);
  }

  // Hiển thị vùng xem trước cắt vát chéo vừa khít chuẩn xác với kích thước khối (không bị dài tràn ra ngoài)
  showSlant(planeType, p1_2d, p2_2d, depthMin, depthMax, cutAbove, bounds = { w: 6, h: 4, d: 4 }) {
    const u1 = p1_2d.u, v1 = p1_2d.v;
    const u2 = p2_2d.u, v2 = p2_2d.v;

    const du = u2 - u1, dv = v2 - v1;
    const len = Math.hypot(du, dv);
    if (len < 0.0001) {
      this.clear();
      return;
    }

    let maxU = bounds.w, maxV = bounds.h;
    if (planeType === 'ZY') { maxU = bounds.d; maxV = bounds.h; }
    else if (planeType === 'XZ') { maxU = bounds.w; maxV = bounds.d; }

    const rect = [
      { u: 0, v: 0 },
      { u: maxU, v: 0 },
      { u: maxU, v: maxV },
      { u: 0, v: maxV }
    ];

    const tU = du / len, tV = dv / len;
    let nU = -tV, nV = tU;

    const isUp = (nV > 0.0001) || (Math.abs(nV) <= 0.0001 && nU > 0);
    if (cutAbove !== isUp) {
      nU = -nU;
      nV = -nV;
    }

    const midU = (u1 + u2) / 2;
    const midV = (v1 + v2) / 2;

    const testFn = (pt) => (nU * (pt.u - midU) + nV * (pt.v - midV)) >= -1e-6;
    const intersectFn = (A, B) => {
      const dA = nU * (A.u - midU) + nV * (A.v - midV);
      const dB = nU * (B.u - midU) + nV * (B.v - midV);
      const t = dA / (dA - dB);
      return { u: A.u + t * (B.u - A.u), v: A.v + t * (B.v - A.v) };
    };

    const poly = [];
    for (let i = 0; i < rect.length; i++) {
      const cur = rect[i];
      const next = rect[(i + 1) % rect.length];
      const curIn = testFn(cur);
      const nextIn = testFn(next);
      if (curIn) {
        poly.push(cur);
        if (!nextIn) poly.push(intersectFn(cur, next));
      } else if (nextIn) {
        poly.push(intersectFn(cur, next));
      }
    }

    if (poly.length < 3) {
      this.clear();
      return;
    }

    const dMin = Math.min(depthMin, depthMax);
    const dMax = Math.max(depthMin, depthMax);

    const to3D = (u, v, depth) => {
      if (planeType === 'XY') return new THREE.Vector3(u, v, depth);
      if (planeType === 'ZY') return new THREE.Vector3(depth, v, u);
      return new THREE.Vector3(u, depth, v);
    };

    const rawTris = [];
    // Mặt đáy dMin
    for (let i = 1; i < poly.length - 1; i++) {
      rawTris.push([to3D(poly[0].u, poly[0].v, dMin), to3D(poly[i+1].u, poly[i+1].v, dMin), to3D(poly[i].u, poly[i].v, dMin)]);
    }
    // Mặt trên dMax
    for (let i = 1; i < poly.length - 1; i++) {
      rawTris.push([to3D(poly[0].u, poly[0].v, dMax), to3D(poly[i].u, poly[i].v, dMax), to3D(poly[i+1].u, poly[i+1].v, dMax)]);
    }
    // Các mặt bên
    for (let i = 0; i < poly.length; i++) {
      const next = (i + 1) % poly.length;
      const b0 = to3D(poly[i].u, poly[i].v, dMin);
      const b1 = to3D(poly[next].u, poly[next].v, dMin);
      const t0 = to3D(poly[i].u, poly[i].v, dMax);
      const t1 = to3D(poly[next].u, poly[next].v, dMax);

      rawTris.push([b0, b1, t1]);
      rawTris.push([b0, t1, t0]);
    }

    const centroid = new THREE.Vector3();
    let ptCount = 0;
    for (const p of poly) {
      centroid.add(to3D(p.u, p.v, dMin));
      centroid.add(to3D(p.u, p.v, dMax));
      ptCount += 2;
    }
    centroid.multiplyScalar(1 / ptCount);

    const positions = [];
    for (let tri of rawTris) {
      let v0 = tri[0], v1 = tri[1], v2 = tri[2];
      const norm = new THREE.Vector3().subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0));
      const mid = new THREE.Vector3().add(v0).add(v1).add(v2).multiplyScalar(1 / 3);
      if (norm.dot(mid.clone().sub(centroid)) < 0) {
        const tmp = v1; v1 = v2; v2 = tmp;
      }
      positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    this.setPreviewGeom(geom);
  }

  // Rãnh V hiển thị chuẩn xác 100% theo các điểm ô lưới mà người dùng đã chọn
  showVGroove(planeType, apex, base1, base2, depthMin, depthMax) {
    const dMin = Math.min(depthMin, depthMax);
    const dMax = Math.max(depthMin, depthMax);
    if (dMax - dMin <= 0.0001) {
      this.clear();
      return;
    }

    const to3D = (u, v, depth) => {
      if (planeType === 'XY') return new THREE.Vector3(u, v, depth);
      if (planeType === 'ZY') return new THREE.Vector3(depth, v, u);
      return new THREE.Vector3(u, depth, v); // 'XZ'
    };

    const A0 = to3D(apex.u, apex.v, dMin), B0 = to3D(base1.u, base1.v, dMin), C0 = to3D(base2.u, base2.v, dMin);
    const A1 = to3D(apex.u, apex.v, dMax), B1 = to3D(base1.u, base1.v, dMax), C1 = to3D(base2.u, base2.v, dMax);

    const centroid = new THREE.Vector3()
      .add(A0).add(B0).add(C0).add(A1).add(B1).add(C1)
      .multiplyScalar(1 / 6);

    let rawTriangles = [
      [A0, B0, C0],
      [A1, C1, B1],
      [A0, A1, B1],
      [A0, B1, B0],
      [B0, B1, C1],
      [B0, C1, C0],
      [C0, C1, A1],
      [C0, A1, A0]
    ];

    const positions = [];
    for (let tri of rawTriangles) {
      let p0 = tri[0], p1 = tri[1], p2 = tri[2];
      const norm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      const mid = new THREE.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3);
      if (norm.dot(mid.clone().sub(centroid)) < 0) {
        const tmp = p1; p1 = p2; p2 = tmp;
      }
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    this.setPreviewGeom(geom);
  }

  // Hiển thị tứ diện xem trước khi vát góc bằng 3 điểm
  showCorner3Points(p1, p2, p3, corner) {
    const P1 = new THREE.Vector3(p1.x, p1.y, p1.z);
    const P2 = new THREE.Vector3(p2.x, p2.y, p2.z);
    const P3 = new THREE.Vector3(p3.x, p3.y, p3.z);
    const O = new THREE.Vector3(corner.x, corner.y, corner.z);

    const centroid = new THREE.Vector3().add(O).add(P1).add(P2).add(P3).multiplyScalar(0.25);

    let rawTris = [
      [O, P1, P2],
      [O, P2, P3],
      [O, P3, P1],
      [P1, P3, P2]
    ];

    const positions = [];
    for (let tri of rawTris) {
      let v0 = tri[0], v1 = tri[1], v2 = tri[2];
      const norm = new THREE.Vector3().subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0));
      const mid = new THREE.Vector3().add(v0).add(v1).add(v2).multiplyScalar(1 / 3);
      if (norm.dot(mid.clone().sub(centroid)) < 0) {
        const tmp = v1; v1 = v2; v2 = tmp;
      }
      positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    this.setPreviewGeom(geom);
  }

  showCorner(ox, oy, oz, dx, dy, dz) {
    if (Math.abs(dx) <= 0.0001 || Math.abs(dy) <= 0.0001 || Math.abs(dz) <= 0.0001) {
      this.clear();
      return;
    }

    const p0 = new THREE.Vector3(ox, oy, oz);
    const p1 = new THREE.Vector3(ox + dx, oy, oz);
    const p2 = new THREE.Vector3(ox, oy + dy, oz);
    const p3 = new THREE.Vector3(ox, oy, oz + dz);

    const centroid = new THREE.Vector3().add(p0).add(p1).add(p2).add(p3).multiplyScalar(0.25);

    let rawTris = [
      [p0, p1, p2],
      [p0, p2, p3],
      [p0, p3, p1],
      [p1, p3, p2]
    ];

    const positions = [];
    for (let tri of rawTris) {
      let v0 = tri[0], v1 = tri[1], v2 = tri[2];
      const norm = new THREE.Vector3().subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0));
      const mid = new THREE.Vector3().add(v0).add(v1).add(v2).multiplyScalar(1 / 3);
      if (norm.dot(mid.clone().sub(centroid)) < 0) {
        const tmp = v1; v1 = v2; v2 = tmp;
      }
      positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    this.setPreviewGeom(geom);
  }
}
