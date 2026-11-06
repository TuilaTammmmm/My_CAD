import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

export class CadEngine {
  constructor() {
    this.evaluator = new Evaluator();
    this.evaluator.useGroups = false;
    this.evaluator.attributes = ['position', 'normal'];

    this.material = new THREE.MeshLambertMaterial({
      color: 0xf8fafc,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x0f172a,
      linewidth: 2
    });
  }

  createBaseBlock(w, h, d) {
    const geom = new THREE.BoxGeometry(w, h, d);
    geom.translate(w / 2, h / 2, d / 2);
    const brush = new Brush(geom, this.material);
    brush.updateMatrixWorld();
    return brush;
  }

  // Cắt hình hộp nhiều ô: X from x1..x2, Y from y1..y2, Z from z1..z2
  cutBox(targetBrush, x1, x2, y1, y2, z1, z2) {
    let minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    let minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    let minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

    const EPS = 0.2;
    // Mở rộng nhẹ dao cắt ra ngoài biên hở nếu chạm mép ngoài
    if (minX <= 0) minX -= EPS;
    if (minY <= 0) minY -= EPS;
    if (minZ <= 0) minZ -= EPS;

    const w = maxX - minX;
    const h = maxY - minY;
    const d = maxZ - minZ;
    if (w <= 0.0001 || h <= 0.0001 || d <= 0.0001) return targetBrush;

    const geom = new THREE.BoxGeometry(w, h, d);
    geom.translate(minX + w / 2, minY + h / 2, minZ + d / 2);

    const uvCount = geom.attributes.position.count * 2;
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));

    const cutter = new Brush(geom);
    cutter.updateMatrixWorld();
    targetBrush.updateMatrixWorld();

    const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
    result.material = this.material;
    result.geometry.computeVertexNormals();
    return result;
  }

  // Tạo khối dao cắt vát nghiêng nửa không gian (Half-Space Slanted Cutter)
  createSlantCutterGeometry(planeType, p1_2d, p2_2d, depthMin, depthMax, cutAbove) {
    const u1 = p1_2d.u, v1 = p1_2d.v;
    const u2 = p2_2d.u, v2 = p2_2d.v;

    const du = u2 - u1, dv = v2 - v1;
    const len = Math.hypot(du, dv);
    if (len < 0.0001) return null;

    const tU = du / len, tV = dv / len;
    let nU = -tV, nV = tU;

    const isUp = (nV > 0.0001) || (Math.abs(nV) <= 0.0001 && nU > 0);
    if (cutAbove !== isUp) {
      nU = -nU;
      nV = -nV;
    }

    const midU = (u1 + u2) / 2;
    const midV = (v1 + v2) / 2;

    const BOX_SPAN = 60;
    const depthSpan = Math.abs(depthMax - depthMin) + 0.4;
    const midDepth = (depthMin + depthMax) / 2;

    const geom = new THREE.BoxGeometry(BOX_SPAN, BOX_SPAN, depthSpan);
    geom.translate(0, BOX_SPAN / 2, 0);

    const angle = Math.atan2(nV, nU) - Math.PI / 2;

    if (planeType === 'XY') {
      geom.rotateZ(angle);
      geom.translate(midU, midV, midDepth);
    } else if (planeType === 'ZY') {
      geom.rotateZ(angle);
      geom.rotateY(-Math.PI / 2);
      geom.translate(midDepth, midV, midU);
    } else if (planeType === 'XZ') {
      geom.rotateZ(angle);
      geom.rotateX(Math.PI / 2);
      geom.translate(midU, midDepth, midV);
    }

    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geom.attributes.position.count * 2), 2));
    geom.computeVertexNormals();
    return geom;
  }

  // Cắt vát chéo nghiêng
  cutSlant(targetBrush, planeType, p1, p2, depthMin, depthMax, cutAbove = true) {
    const geom = this.createSlantCutterGeometry(planeType, p1, p2, depthMin, depthMax, cutAbove);
    if (!geom) return targetBrush;

    const cutter = new Brush(geom);
    cutter.updateMatrixWorld();
    targetBrush.updateMatrixWorld();

    const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
    result.material = this.material;
    result.geometry.computeVertexNormals();
    return result;
  }

  // Kiểm tra 3 điểm có cùng nằm trên 1 mặt phẳng chính (XY, ZY hoặc XZ) không
  isCoplanarOnFace(p1, p2, p3) {
    if (Math.abs(p1.z - p2.z) < 0.01 && Math.abs(p1.z - p3.z) < 0.01) return 'XY';
    if (Math.abs(p1.x - p2.x) < 0.01 && Math.abs(p1.x - p3.x) < 0.01) return 'ZY';
    if (Math.abs(p1.y - p2.y) < 0.01 && Math.abs(p1.y - p3.y) < 0.01) return 'XZ';
    return null;
  }

  // Tạo khối dao cắt mặt phẳng 3D qua 3 điểm (chuẩn nửa không gian, giới hạn chính xác tuyệt đối)
  createPlaneCutterGeometry(p1, p2, p3, cutPositive = true, isFullDepth = false) {
    const P1 = new THREE.Vector3(p1.x, p1.y, p1.z);
    const P2 = new THREE.Vector3(p2.x, p2.y, p2.z);
    const P3 = new THREE.Vector3(p3.x, p3.y, p3.z);

    const v1 = new THREE.Vector3().subVectors(P2, P1);
    const v2 = new THREE.Vector3().subVectors(P3, P1);
    const normal = new THREE.Vector3().crossVectors(v1, v2);
    if (normal.lengthSq() < 1e-8) return null;
    normal.normalize();

    if (!cutPositive) {
      normal.negate();
    }

    const mid = new THREE.Vector3().add(P1).add(P2).add(P3).multiplyScalar(1 / 3);

    // Khối hộp đồng nhất lớn (Half-space box)
    const SPAN = 100;
    const geom = new THREE.BoxGeometry(SPAN, SPAN, SPAN);
    // Dời tâm để mặt phẳng cắt đi đúng qua z=0
    geom.translate(0, 0, SPAN / 2);

    const defaultDir = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, normal);
    geom.applyQuaternion(quat);
    geom.translate(mid.x, mid.y, mid.z);

    const uvCount = geom.attributes.position.count * 2;
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));
    geom.computeVertexNormals();

    // Giới hạn theo phạm vi điểm dọc trục bất biến (nếu không chọn cắt xuyên suốt)
    if (!isFullDepth) {
      let boundBox = null;
      if (Math.abs(normal.x) < 0.02) {
        const minX = Math.min(P1.x, P2.x, P3.x) - 0.05;
        const maxX = Math.max(P1.x, P2.x, P3.x) + 0.05;
        boundBox = new THREE.BoxGeometry(Math.max(0.1, maxX - minX), SPAN, SPAN);
        boundBox.translate((minX + maxX) / 2, mid.y, mid.z);
      } else if (Math.abs(normal.y) < 0.02) {
        const minY = Math.min(P1.y, P2.y, P3.y) - 0.05;
        const maxY = Math.max(P1.y, P2.y, P3.y) + 0.05;
        boundBox = new THREE.BoxGeometry(SPAN, Math.max(0.1, maxY - minY), SPAN);
        boundBox.translate(mid.x, (minY + maxY) / 2, mid.z);
      } else if (Math.abs(normal.z) < 0.02) {
        const minZ = Math.min(P1.z, P2.z, P3.z) - 0.05;
        const maxZ = Math.max(P1.z, P2.z, P3.z) + 0.05;
        boundBox = new THREE.BoxGeometry(SPAN, SPAN, Math.max(0.1, maxZ - minZ));
        boundBox.translate(mid.x, mid.y, (minZ + maxZ) / 2);
      }

      if (boundBox) {
        boundBox.computeVertexNormals();
        const bUv = boundBox.attributes.position.count * 2;
        boundBox.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(bUv), 2));
        const b1 = new Brush(geom);
        const b2 = new Brush(boundBox);
        b1.updateMatrixWorld();
        b2.updateMatrixWorld();
        try {
          const boundedBrush = this.evaluator.evaluate(b1, b2, INTERSECTION);
          if (boundedBrush && boundedBrush.geometry && boundedBrush.geometry.attributes.position.count > 0) {
            return boundedBrush.geometry;
          }
        } catch (e) {}
      }
    }

    return geom;
  }

  // Cắt vát qua 3 điểm: Tự động phân loại rãnh tam giác trên mặt hoặc mặt phẳng 3D
  cutPlane3Points(targetBrush, p1, p2, p3, cutPositive = true, isFullDepth = false, customDepth = 0) {
    if (this.isCoplanarOnFace(p1, p2, p3)) {
      return this.cutMultiPointVolume(targetBrush, [p1, p2, p3], customDepth, isFullDepth);
    }

    const geom = this.createPlaneCutterGeometry(p1, p2, p3, cutPositive, isFullDepth);
    if (!geom) return targetBrush;

    const cutter = new Brush(geom);
    cutter.updateMatrixWorld();
    targetBrush.updateMatrixWorld();

    const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
    result.material = this.material;
    result.geometry.computeVertexNormals();
    return result;
  }

  // CẮT ĐA GIÁC / KHỐI ĐA DIỆN TỰ DO QUA NHIỀU ĐIỂM (MULTI-POINT POLYGON & POLYHEDRON CUT)
  cutMultiPointVolume(targetBrush, points3D, customDepth = 0, isFullDepth = true) {
    if (!points3D || points3D.length < 3) return targetBrush;

    const pts = points3D.map(p => new THREE.Vector3(p.x, p.y, p.z));

    // 1. Kiểm tra nếu các điểm là khối 3D không đồng phẳng (Non-coplanar 3D Hull)
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

        const cutter = new Brush(geom);
        cutter.updateMatrixWorld();
        targetBrush.updateMatrixWorld();

        const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
        result.material = this.material;
        result.geometry.computeVertexNormals();
        return result;
      } catch (err) {
        console.error('Lỗi khi tạo ConvexGeometry:', err);
      }
    }

    // 2. Nếu các điểm cùng nằm trên 1 mặt chiếu (XY, ZY hoặc XZ): Cắt đùn đa giác (Extruded Polygon Cut)
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const zs = pts.map(p => p.z);

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    let planeType = 'XY';
    let pts2d = [];
    let depthSpan = isFullDepth ? 60 : (customDepth || 4);
    let faceCoord = 0;

    if (maxZ - minZ < 0.05) {
      planeType = 'XY';
      pts2d = pts.map(p => new THREE.Vector2(p.x, p.y));
      faceCoord = minZ;
    } else if (maxX - minX < 0.05) {
      planeType = 'ZY';
      pts2d = pts.map(p => new THREE.Vector2(p.z, p.y));
      faceCoord = minX;
    } else if (maxY - minY < 0.05) {
      planeType = 'XZ';
      pts2d = pts.map(p => new THREE.Vector2(p.x, p.z));
      faceCoord = minY;
    } else {
      // Mặc định ZY nếu trải dài theo Z và Y
      planeType = 'ZY';
      pts2d = pts.map(p => new THREE.Vector2(p.z, p.y));
      faceCoord = minX;
    }

    const shape = new THREE.Shape(pts2d);
    const extrudeSettings = { steps: 1, depth: depthSpan + 0.1, bevelEnabled: false };
    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    if (planeType === 'XY') {
      if (faceCoord > 0.05) {
        geom.translate(0, 0, faceCoord - depthSpan);
      } else {
        geom.translate(0, 0, -0.05);
      }
    } else if (planeType === 'ZY') {
      geom.rotateY(-Math.PI / 2);
      if (faceCoord > 0.05) {
        geom.translate(faceCoord, 0, 0);
      } else {
        geom.translate(faceCoord + depthSpan + 0.05, 0, 0);
      }
    } else if (planeType === 'XZ') {
      geom.rotateX(Math.PI / 2);
      if (faceCoord > 0.05) {
        geom.translate(0, faceCoord, 0);
      } else {
        geom.translate(0, faceCoord + depthSpan + 0.05, 0);
      }
    }

    geom.computeVertexNormals();
    const uvCount = geom.attributes.position.count * 2;
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));

    const cutter = new Brush(geom);
    cutter.updateMatrixWorld();
    targetBrush.updateMatrixWorld();

    const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
    result.material = this.material;
    result.geometry.computeVertexNormals();
    return result;
  }

  // Cắt rãnh chữ V (V-Groove):
  // Apex giữ nguyên chuẩn tọa độ grid, chỉ mở nhẹ 2 chân base ra ngoài để đục thủng
  cutVGroove(targetBrush, planeType, apex, base1, base2, depthMin, depthMax) {
    const depth = Math.abs(depthMax - depthMin);
    if (depth <= 0.0001) return targetBrush;

    const d1 = { u: base1.u - apex.u, v: base1.v - apex.v };
    const len1 = Math.hypot(d1.u, d1.v) || 1;
    const extBase1 = { u: base1.u + (d1.u / len1) * 0.4, v: base1.v + (d1.v / len1) * 0.4 };

    const d2 = { u: base2.u - apex.u, v: base2.v - apex.v };
    const len2 = Math.hypot(d2.u, d2.v) || 1;
    const extBase2 = { u: base2.u + (d2.u / len2) * 0.4, v: base2.v + (d2.v / len2) * 0.4 };

    const geom = this.createPrismGeometry(apex, extBase1, extBase2, planeType, depthMin, depthMax);

    const cutter = new Brush(geom);
    cutter.updateMatrixWorld();
    targetBrush.updateMatrixWorld();

    const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
    result.material = this.material;
    result.geometry.computeVertexNormals();
    return result;
  }

  // Helper tạo hình lăng trụ tam giác 3D cho rãnh V với chuẩn pháp tuyến hướng ra ngoài
  createPrismGeometry(pA, pB, pC, planeType, depthMin, depthMax) {
    let dMin = Math.min(depthMin, depthMax) - 0.15;
    let dMax = Math.max(depthMin, depthMax) + 0.15;

    const to3D = (u, v, depth) => {
      if (planeType === 'XY') return new THREE.Vector3(u, v, depth);
      if (planeType === 'ZY') return new THREE.Vector3(depth, v, u);
      return new THREE.Vector3(u, depth, v); // 'XZ'
    };

    const A0 = to3D(pA.u, pA.v, dMin), B0 = to3D(pB.u, pB.v, dMin), C0 = to3D(pC.u, pC.v, dMin);
    const A1 = to3D(pA.u, pA.v, dMax), B1 = to3D(pB.u, pB.v, dMax), C1 = to3D(pC.u, pC.v, dMax);

    // Trọng tâm của hình lăng trụ
    const centroid = new THREE.Vector3()
      .add(A0).add(B0).add(C0).add(A1).add(B1).add(C1)
      .multiplyScalar(1 / 6);

    let rawTriangles = [
      // 2 mặt đáy
      [A0, B0, C0],
      [A1, C1, B1],
      // 3 mặt bên
      [A0, A1, B1],
      [A0, B1, B0],
      [B0, B1, C1],
      [B0, C1, C0],
      [C0, C1, A1],
      [C0, A1, A0]
    ];

    // Chuẩn hóa winding order: mọi tam giác đều phải có pháp tuyến hướng RA NGOÀI lăng trụ
    const positions = [];
    for (let tri of rawTriangles) {
      let p0 = tri[0], p1 = tri[1], p2 = tri[2];
      const norm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      const mid = new THREE.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3);
      const toMid = new THREE.Vector3().subVectors(mid, centroid);

      // Nếu pháp tuyến chĩa vào trong tâm, đổi thứ tự đỉnh để quay ra ngoài
      if (norm.dot(toMid) < 0) {
        const tmp = p1; p1 = p2; p2 = tmp;
      }
      positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
    geom.computeVertexNormals();
    return geom;
  }

  // Tìm danh sách đỉnh góc hộp phù hợp cho 3 điểm vát P1, P2, P3
  findCandidateCornersFor3Points(p1, p2, p3) {
    const xs = [p1.x, p2.x, p3.x];
    const ys = [p1.y, p2.y, p3.y];
    const zs = [p1.z, p2.z, p3.z];

    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);

    const candidates = [
      new THREE.Vector3(minX, minY, minZ),
      new THREE.Vector3(minX, minY, maxZ),
      new THREE.Vector3(minX, maxY, minZ),
      new THREE.Vector3(minX, maxY, maxZ),
      new THREE.Vector3(maxX, minY, minZ),
      new THREE.Vector3(maxX, minY, maxZ),
      new THREE.Vector3(maxX, maxY, minZ),
      new THREE.Vector3(maxX, maxY, maxZ),
    ];

    const scored = [];
    for (const c of candidates) {
      let score = 0;
      if (p1.x === c.x) score++;
      if (p1.y === c.y) score++;
      if (p1.z === c.z) score++;

      if (p2.x === c.x) score++;
      if (p2.y === c.y) score++;
      if (p2.z === c.z) score++;

      if (p3.x === c.x) score++;
      if (p3.y === c.y) score++;
      if (p3.z === c.z) score++;

      const v1 = new THREE.Vector3().subVectors(p1, c);
      const v2 = new THREE.Vector3().subVectors(p2, c);
      const v3 = new THREE.Vector3().subVectors(p3, c);
      const vol = Math.abs(v1.dot(v2.clone().cross(v3)));

      if (vol > 0.0001) {
        scored.push({ corner: c, score, vol });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.vol - b.vol);
    return scored.map(s => s.corner);
  }

  // Cắt vát góc 3D xác định trực tiếp bởi 3 điểm lưới trên hình
  cutCorner3Points(targetBrush, p1, p2, p3, customCorner = null) {
    let o = customCorner;
    if (!o) {
      const candidates = this.findCandidateCornersFor3Points(p1, p2, p3);
      if (candidates.length === 0) return targetBrush;
      o = candidates[0];
    }

    const P1 = new THREE.Vector3(p1.x, p1.y, p1.z);
    const P2 = new THREE.Vector3(p2.x, p2.y, p2.z);
    const P3 = new THREE.Vector3(p3.x, p3.y, p3.z);
    const O = new THREE.Vector3(o.x, o.y, o.z);

    // Mở rộng đỉnh O nhẹ ra ngoài để đảm bảo dao cắt đục thủng hoàn toàn vỏ ngoài của góc
    const triCenter = new THREE.Vector3().add(P1).add(P2).add(P3).multiplyScalar(1 / 3);
    const outDir = new THREE.Vector3().subVectors(O, triCenter).normalize();
    const oExt = O.clone().addScaledVector(outDir, 0.25);

    // Tứ diện dao cắt gồm đỉnh mở rộng oExt và 3 điểm vát chuẩn xác P1, P2, P3
    const centroid = new THREE.Vector3().add(oExt).add(P1).add(P2).add(P3).multiplyScalar(0.25);

    let rawTris = [
      [oExt, P1, P2],
      [oExt, P2, P3],
      [oExt, P3, P1],
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

    const cutter = new Brush(geom);
    cutter.updateMatrixWorld();
    targetBrush.updateMatrixWorld();

    const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
    result.material = this.material;
    result.geometry.computeVertexNormals();
    return result;
  }

  // Cắt vát góc tam giác 3D (Corner Chamfer):
  cutCorner3D(targetBrush, ox, oy, oz, dx, dy, dz) {
    if (Math.abs(dx) <= 0.0001 || Math.abs(dy) <= 0.0001 || Math.abs(dz) <= 0.0001) return targetBrush;

    const EPS = 0.15;
    const pox = ox + (dx > 0 ? -EPS : EPS);
    const poy = oy + (dy > 0 ? -EPS : EPS);
    const poz = oz + (dz > 0 ? -EPS : EPS);

    const p0 = new THREE.Vector3(pox, poy, poz);
    const p1 = new THREE.Vector3(ox + dx, poy, poz);
    const p2 = new THREE.Vector3(pox, oy + dy, poz);
    const p3 = new THREE.Vector3(pox, poy, oz + dz);

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
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
    geom.computeVertexNormals();

    const cutter = new Brush(geom);
    cutter.updateMatrixWorld();
    targetBrush.updateMatrixWorld();

    const result = this.evaluator.evaluate(targetBrush, cutter, SUBTRACTION);
    result.material = this.material;
    result.geometry.computeVertexNormals();
    return result;
  }

  // TẠO ĐƯỜNG VIỀN KỸ THUẬT SẠCH SẼ (LỌC 100% CÁC NÉT CHÉO RÁC NỘI BỘ VÀ T-JUNCTIONS)
  createEdges(mesh) {
    const nonIndexedGeom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const cleanGeom = mergeVertices(nonIndexedGeom, 0.001);
    const rawEdges = new THREE.EdgesGeometry(cleanGeom, 25);
    const ePos = rawEdges.attributes.position;
    if (!ePos || ePos.count === 0) {
      return new THREE.LineSegments(rawEdges, this.edgeMaterial);
    }

    // Trích xuất danh sách tam giác và pháp tuyến từ geometry chuẩn không bị lệch index
    const pos = nonIndexedGeom.attributes.position;
    const triCount = pos.count / 3;
    const triangles = [];
    for (let i = 0; i < triCount; i++) {
      const p0 = new THREE.Vector3(pos.getX(i*3), pos.getY(i*3), pos.getZ(i*3));
      const p1 = new THREE.Vector3(pos.getX(i*3+1), pos.getY(i*3+1), pos.getZ(i*3+1));
      const p2 = new THREE.Vector3(pos.getX(i*3+2), pos.getY(i*3+2), pos.getZ(i*3+2));
      const norm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      const len = norm.length();
      if (len > 1e-6) {
        triangles.push({ p0, p1, p2, norm: norm.normalize() });
      }
    }

    // Kiểm tra điểm P có nằm trong bất kỳ tam giác nào thuộc mặt phẳng có pháp tuyến tương thích
    function isPointInPlanarTriangles(P, N) {
      const EPS = 0.002;
      for (const t of triangles) {
        if (Math.abs(t.norm.dot(N)) > 0.98) {
          const distToPlane = Math.abs(t.norm.dot(P.clone().sub(t.p0)));
          if (distToPlane < 0.015) {
            // Tọa độ trọng tâm (Barycentric coordinates) 3D chính xác tuyệt đối
            const v0 = new THREE.Vector3().subVectors(t.p2, t.p0);
            const v1 = new THREE.Vector3().subVectors(t.p1, t.p0);
            const v2 = new THREE.Vector3().subVectors(P, t.p0);

            const dot00 = v0.dot(v0);
            const dot01 = v0.dot(v1);
            const dot02 = v0.dot(v2);
            const dot11 = v1.dot(v1);
            const dot12 = v1.dot(v2);

            const denom = (dot00 * dot11 - dot01 * dot01);
            if (Math.abs(denom) < 1e-8) continue;
            const invDenom = 1 / denom;
            const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
            const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

            if (u >= -EPS && v >= -EPS && (u + v) <= 1 + EPS) {
              return true;
            }
          }
        }
      }
      return false;
    }

    const filteredPositions = [];

    for (let i = 0; i < ePos.count; i += 2) {
      const A = new THREE.Vector3(ePos.getX(i), ePos.getY(i), ePos.getZ(i));
      const B = new THREE.Vector3(ePos.getX(i+1), ePos.getY(i+1), ePos.getZ(i+1));
      const dir = new THREE.Vector3().subVectors(B, A);
      const len = dir.length();
      if (len < 0.0001) continue;
      dir.normalize();

      let isInternalSplit = false;
      const tSamples = [0.5, 0.35, 0.65];

      for (const t of triangles) {
        // Nếu đoạn thẳng AB cùng nằm trên mặt phẳng tam giác t
        if (Math.abs(t.norm.dot(A.clone().sub(t.p0))) < 0.01 && Math.abs(t.norm.dot(B.clone().sub(t.p0))) < 0.01) {
          const perp = new THREE.Vector3().crossVectors(t.norm, dir).normalize();

          for (const sampleT of tSamples) {
            const ptOnSegment = new THREE.Vector3().addVectors(A.clone().multiplyScalar(1 - sampleT), B.clone().multiplyScalar(sampleT));
            for (const offset of [0.02, 0.01]) {
              const pLeft = ptOnSegment.clone().addScaledVector(perp, offset);
              const pRight = ptOnSegment.clone().addScaledVector(perp, -offset);

              // Nếu cả 2 phía vuông góc của đoạn thẳng đều thuộc cùng một mặt phẳng của khối:
              // Đây 100% là nét rác phân mảnh nội bộ (tessellation split), cần loại bỏ!
              if (isPointInPlanarTriangles(pLeft, t.norm) && isPointInPlanarTriangles(pRight, t.norm)) {
                isInternalSplit = true;
                break;
              }
            }
            if (isInternalSplit) break;
          }
        }
        if (isInternalSplit) break;
      }

      if (!isInternalSplit) {
        filteredPositions.push(A.x, A.y, A.z, B.x, B.y, B.z);
      }
    }

    const finalGeom = new THREE.BufferGeometry();
    finalGeom.setAttribute('position', new THREE.Float32BufferAttribute(filteredPositions, 3));

    const edges = new THREE.LineSegments(finalGeom, this.edgeMaterial);
    edges.position.copy(mesh.position);
    edges.rotation.copy(mesh.rotation);
    edges.scale.copy(mesh.scale);
    return edges;
  }
}
