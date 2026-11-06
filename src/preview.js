import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Brush, INTERSECTION } from 'three-bvh-csg';

export class CutterPreview {
  constructor(scene) {
    this.scene = scene;
    this.previewMesh = null;
    this.previewEdges = null;

    // Vật liệu bóng mờ đỏ chuẩn CAD chống z-fighting
    this.material = new THREE.MeshLambertMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
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
    this.previewMesh.renderOrder = 1002;
    this.previewEdges.renderOrder = 1003;
    this.scene.add(this.previewMesh);
    this.scene.add(this.previewEdges);
  }

  // TRUNG TÂM GIAO THỂ TÍCH: Chỉ hiển thị vùng đỏ nằm THỰC SỰ BÊN TRONG KHỐI VẬT THỂ
  setPreviewCutter(cutterGeom, currentBrush = null, cadEngine = null) {
    if (!cutterGeom) {
      this.clear();
      return;
    }

    if (currentBrush && cadEngine && cadEngine.evaluator) {
      try {
        const cutter = new Brush(cutterGeom);
        cutter.updateMatrixWorld();
        currentBrush.updateMatrixWorld();
        const previewBrush = cadEngine.evaluator.evaluate(currentBrush, cutter, INTERSECTION);
        if (previewBrush && previewBrush.geometry && previewBrush.geometry.attributes.position.count > 0) {
          previewBrush.geometry.computeVertexNormals();
          this.setPreviewGeom(previewBrush.geometry);
          return;
        }
      } catch (err) {}
    }

    this.setPreviewGeom(cutterGeom);
  }

  // Hiển thị xem trước cắt hộp
  showBox(x1, x2, y1, y2, z1, z2, currentBrush = null, cadEngine = null) {
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
    const uvCount = geom.attributes.position.count * 2;
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));
    geom.computeVertexNormals();

    this.setPreviewCutter(geom, currentBrush, cadEngine);
  }

  // Hiển thị xem trước vát chéo 2 điểm
  showSlant(planeType, p1_2d, p2_2d, depthMin, depthMax, cutAbove, bounds = { w: 6, h: 4, d: 4 }, currentBrush = null, cadEngine = null) {
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
    for (let i = 1; i < poly.length - 1; i++) {
      rawTris.push([to3D(poly[0].u, poly[0].v, dMin), to3D(poly[i+1].u, poly[i+1].v, dMin), to3D(poly[i].u, poly[i].v, dMin)]);
    }
    for (let i = 1; i < poly.length - 1; i++) {
      rawTris.push([to3D(poly[0].u, poly[0].v, dMax), to3D(poly[i].u, poly[i].v, dMax), to3D(poly[i+1].u, poly[i+1].v, dMax)]);
    }
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
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
    geom.computeVertexNormals();

    this.setPreviewCutter(geom, currentBrush, cadEngine);
  }

  // Hiển thị xem trước vát chéo 3 điểm: Tự động phân loại rãnh tam giác hay mặt phẳng 3D
  showPlane3Points(p1, p2, p3, cutPositive, bounds, currentBrush, cadEngine, isFullDepth = false, customDepth = 0) {
    if (!cadEngine) return;

    // Nếu 3 điểm cùng nằm trên 1 mặt chính (ví dụ notch F): Xem trước rãnh tam giác đùn
    if (cadEngine.isCoplanarOnFace && cadEngine.isCoplanarOnFace(p1, p2, p3)) {
      this.showMultiPointVolume([p1, p2, p3], customDepth, isFullDepth, bounds, currentBrush, cadEngine);
      return;
    }

    const geom = cadEngine.createPlaneCutterGeometry(p1, p2, p3, cutPositive, isFullDepth);
    if (!geom) {
      this.clear();
      return;
    }

    this.setPreviewCutter(geom, currentBrush, cadEngine);
  }

  // Hiển thị xem trước cắt đa giác / khối đa diện tự do qua N điểm
  showMultiPointVolume(points3D, depth, isFullDepth, bounds, currentBrush, cadEngine) {
    if (!points3D || points3D.length < 3) {
      this.clear();
      return;
    }

    const pts = points3D.map(p => new THREE.Vector3(p.x, p.y, p.z));

    // 1. Nếu là khối đa diện 3D không đồng phẳng (3D Hull)
    let isPlanar = true;
    if (pts.length >= 4) {
      const v1 = new THREE.Vector3().subVectors(pts[1], pts[0]);
      const v2 = new THREE.Vector3().subVectors(pts[2], pts[0]);
      const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();
      for (let i = 3; i < pts.length; i++) {
        const vi = new THREE.Vector3().subVectors(pts[i], pts[0]);
        if (Math.abs(normal.dot(vi)) > 0.05) {
          isPlanar = false;
          break;
        }
      }
    }

    if (!isPlanar && pts.length >= 4) {
      try {
        const geom = new ConvexGeometry(pts);
        geom.computeVertexNormals();
        const uvCount = geom.attributes.position.count * 2;
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));
        this.setPreviewCutter(geom, currentBrush, cadEngine);
        return;
      } catch (err) {}
    }

    // 2. Nếu là đa giác phẳng: Extrude preview
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const zs = pts.map(p => p.z);

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    let planeType = 'XY';
    let pts2d = [];
    let depthSpan = isFullDepth ? (bounds ? bounds.d : 4) : (depth || 4);
    let faceCoord = 0;

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;

    if (spanZ <= spanX && spanZ <= spanY) {
      planeType = 'XY';
      pts2d = pts.map(p => new THREE.Vector2(p.x, p.y));
      faceCoord = minZ;
      if (isFullDepth && bounds) depthSpan = bounds.d;
    } else if (spanX <= spanZ && spanX <= spanY) {
      planeType = 'ZY';
      pts2d = pts.map(p => new THREE.Vector2(p.z, p.y));
      faceCoord = minX;
      if (isFullDepth && bounds) depthSpan = bounds.w;
    } else {
      planeType = 'XZ';
      pts2d = pts.map(p => new THREE.Vector2(p.x, p.z));
      faceCoord = minY;
      if (isFullDepth && bounds) depthSpan = bounds.h;
    }

    const shape = new THREE.Shape(pts2d);
    const geom = new THREE.ExtrudeGeometry(shape, { steps: 1, depth: depthSpan, bevelEnabled: false });

    if (planeType === 'XY') {
      if (faceCoord > 0.05) {
        geom.translate(0, 0, faceCoord - depthSpan);
      }
    } else if (planeType === 'ZY') {
      geom.rotateY(-Math.PI / 2);
      if (faceCoord > 0.05) {
        geom.translate(faceCoord, 0, 0);
      } else {
        geom.translate(faceCoord + depthSpan, 0, 0);
      }
    } else if (planeType === 'XZ') {
      geom.rotateX(Math.PI / 2);
      if (faceCoord > 0.05) {
        geom.translate(0, faceCoord, 0);
      } else {
        geom.translate(0, faceCoord + depthSpan, 0);
      }
    }

    geom.computeVertexNormals();
    const uvCount = geom.attributes.position.count * 2;
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));

    this.setPreviewCutter(geom, currentBrush, cadEngine);
  }

  // Hiển thị xem trước rãnh chữ V
  showVGroove(planeType, apex, base1, base2, depthMin, depthMax, currentBrush = null, cadEngine = null) {
    const dMin = Math.min(depthMin, depthMax);
    const dMax = Math.max(depthMin, depthMax);
    if (dMax - dMin <= 0.0001) {
      this.clear();
      return;
    }

    const to3D = (u, v, depth) => {
      if (planeType === 'XY') return new THREE.Vector3(u, v, depth);
      if (planeType === 'ZY') return new THREE.Vector3(depth, v, u);
      return new THREE.Vector3(u, depth, v);
    };

    const A0 = to3D(apex.u, apex.v, dMin), B0 = to3D(base1.u, base1.v, dMin), C0 = to3D(base2.u, base2.v, dMin);
    const A1 = to3D(apex.u, apex.v, dMax), B1 = to3D(base1.u, base1.v, dMax), C1 = to3D(base2.u, base2.v, dMax);

    const centroid = new THREE.Vector3()
      .add(A0).add(B0).add(C0).add(A1).add(B1).add(C1)
      .multiplyScalar(1 / 6);

    const rawTris = [
      [A0, C0, B0],
      [A1, B1, C1],
      [A0, B0, B1], [A0, B1, A1],
      [B0, C0, C1], [B0, C1, B1],
      [C0, A0, A1], [C0, A1, C1]
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
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
    geom.computeVertexNormals();

    this.setPreviewCutter(geom, currentBrush, cadEngine);
  }

  // Hiển thị xem trước vát góc tam giác 3 điểm
  showCorner3Points(p1, p2, p3, corner, currentBrush = null, cadEngine = null) {
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
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
    geom.computeVertexNormals();

    this.setPreviewCutter(geom, currentBrush, cadEngine);
  }
}
