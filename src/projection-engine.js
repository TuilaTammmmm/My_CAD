import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isOCCTReady, replicad } from './occt-kernel.js';

/**
 * ProjectionEngine
 * Trích xuất 3 hình chiếu vuông góc kỹ thuật (Front, Top, Right) từ mô hình 3D
 * - Chỉ trích xuất các Nét Thấy (Visible lines) thực tế trên từng mặt (Back-face culled)
 * - Loại bỏ hoàn toàn nét ẩn/nét khuất không cần thiết theo yêu cầu người dùng
 * - Khắc phục triệt để hiện tượng lẫn lộn nét giữa mặt Đứng (Front) và mặt Bằng (Top)
 * - Gộp các phân đoạn thẳng hàng 1D (Collinear Interval Merging) cho đường nét liền mạch tuyệt đối
 */
export class ProjectionEngine {
  constructor(cadEngine) {
    this.cad = cadEngine;
  }

  /**
   * Tính toán các hình chiếu vuông góc từ mô hình brush 3D
   * @param {THREE.Mesh} brush - Khối 3D hiện tại
   * @param {Object} bounds - Kích thước { w, h, d }
   * @returns {Object} { front, top, side, right, bounds }
   */
  generateProjections(brush, bounds = { w: 6, h: 4, d: 4 }) {
    if (!brush || !brush.geometry) {
      return {
        front: { visible: [], hidden: [] },
        top: { visible: [], hidden: [] },
        side: { visible: [], hidden: [] },
        right: { visible: [], hidden: [] },
        bounds
      };
    }

    const front = this.projectOrthographic(brush, 'front', bounds);
    const top = this.projectOrthographic(brush, 'top', bounds);
    const right = this.projectOrthographic(brush, 'right', bounds);
    const side = right;

    return { front, top, side, right, bounds };
  }

  /**
   * Chiếu trực giao một hướng nhìn cụ thể
   */
  projectOrthographic(brush, viewType, bounds) {
    if (isOCCTReady() && brush?._replicadShape) {
      try {
        return this.projectWithOCCT(brush._replicadShape, viewType, bounds);
      } catch (err) {
        console.warn('OCCT HLR projection fallback:', err);
      }
    }

    const { w, h, d } = bounds;
    let viewDir, rayOriginFn, map2DFn;

    if (viewType === 'front') {
      // 1. FRONT VIEW: Camera nhìn theo trục -Z (từ phía trước +Z về Z = 0)
      // 2D: u = X, v = Y (Phạm vi: [0, w] x [0, h])
      viewDir = new THREE.Vector3(0, 0, -1);
      rayOriginFn = (pt) => new THREE.Vector3(pt.x, pt.y, d + 50);
      map2DFn = (pt) => ({ u: Number(pt.x.toFixed(3)), v: Number(pt.y.toFixed(3)) });

    } else if (viewType === 'top') {
      // 2. TOP VIEW: Camera nhìn theo trục -Y (từ trên nóc +Y xuống Y = 0)
      // 2D: u = X, v = d - Z (Mặt trước Z=d ở dưới v=0, mặt sau Z=0 ở trên v=d) (Phạm vi: [0, w] x [0, d])
      viewDir = new THREE.Vector3(0, -1, 0);
      rayOriginFn = (pt) => new THREE.Vector3(pt.x, h + 50, pt.z);
      map2DFn = (pt) => ({ u: Number(pt.x.toFixed(3)), v: Number((d - pt.z).toFixed(3)) });

    } else if (viewType === 'right' || viewType === 'side') {
      // 3. RIGHT VIEW: Camera nhìn từ bên phải theo trục -X (từ +X về X = 0)
      // 2D: u = d - Z (Mặt trước Z=d bên trái người nhìn u=0, mặt sau Z=0 bên phải u=d), v = Y ([0, d] x [0, h])
      viewDir = new THREE.Vector3(-1, 0, 0);
      rayOriginFn = (pt) => new THREE.Vector3(w + 50, pt.y, pt.z);
      map2DFn = (pt) => ({ u: Number((d - pt.z).toFixed(3)), v: Number(pt.y.toFixed(3)) });
    }

    // 1. Lọc cạnh có mặt kề hướng về camera (Back-face Culling từ các cạnh kỹ thuật sạch của khối)
    const candidateEdges = this.extractCandidateEdges(brush, viewDir);

    brush.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    const visibleSegments = [];

    for (const edge of candidateEdges) {
      const p1_2d = map2DFn(edge.p1);
      const p2_2d = map2DFn(edge.p2);
      const len2D = Math.hypot(p2_2d.u - p1_2d.u, p2_2d.v - p1_2d.v);
      if (len2D < 0.005) continue; // Cạnh chiếu thành điểm

      const len3D = edge.p1.distanceTo(edge.p2);
      const numSub = Math.max(1, Math.min(6, Math.round(len3D / 0.5)));

      for (let s = 0; s < numSub; s++) {
        const t1 = s / numSub;
        const t2 = (s + 1) / numSub;
        const subP1_3D = new THREE.Vector3().lerpVectors(edge.p1, edge.p2, t1);
        const subP2_3D = new THREE.Vector3().lerpVectors(edge.p1, edge.p2, t2);
        const mid3D = new THREE.Vector3().lerpVectors(subP1_3D, subP2_3D, 0.5);

        const subP1_2D = map2DFn(subP1_3D);
        const subP2_2D = map2DFn(subP2_3D);

        // Bắn tia kiểm tra che khuất bởi mặt khác phía trước
        const origin = rayOriginFn(mid3D);
        const distToMid = origin.distanceTo(mid3D);
        raycaster.set(origin, viewDir);
        raycaster.near = 0.1;
        raycaster.far = distToMid + 20;

        const hits = raycaster.intersectObject(brush, false);
        let isOccluded = false;

        for (const hit of hits) {
          // Nếu có bất kỳ mặt nào chắn trước điểm kiểm tra ít nhất 0.08 đơn vị -> bị che khuất
          if (hit.distance < distToMid - 0.08) {
            isOccluded = true;
            break;
          }
        }

        if (!isOccluded) {
          visibleSegments.push({ p1: subP1_2D, p2: subP2_2D });
        }
      }
    }

    // 2. Gộp các đoạn thẳng cùng phương thành các cạnh hoàn chỉnh
    const mergedVisible = this.mergeCollinear2DLines(visibleSegments);

    return {
      visible: mergedVisible,
      hidden: [] // Chỉ giữ nét thấy, không hiển thị nét ẩn theo yêu cầu
    };
  }

  /**
   * Trích xuất các cạnh ứng viên thực sự nhìn thấy từ hướng chiếu
   * Lấy trực tiếp từ các cạnh kỹ thuật sạch của CadEngine (đã lọc nét rác, góc cắt 25 độ, nối liền)
   * và áp dụng Back-Face Culling để loại bỏ hoàn toàn các cạnh nằm ở mặt sau/đáy.
   */
  extractCandidateEdges(brush, viewDir) {
    let ePos = null;
    if (this.cad && this.cad.createEdges) {
      const edgeMesh = this.cad.createEdges(brush);
      if (edgeMesh && edgeMesh.geometry && edgeMesh.geometry.attributes.position) {
        ePos = edgeMesh.geometry.attributes.position;
      }
    }

    if (!ePos || ePos.count === 0) {
      const nonIndexed = brush.geometry.index ? brush.geometry.toNonIndexed() : brush.geometry;
      const cleanGeom = mergeVertices(nonIndexed, 0.001);
      const rawEdges = new THREE.EdgesGeometry(cleanGeom, 25);
      ePos = rawEdges.attributes.position;
    }

    if (!ePos || ePos.count === 0) return [];

    // Lấy danh sách tam giác và pháp tuyến mặt của khối 3D
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

    const candidateEdges = [];

    for (let i = 0; i < ePos.count; i += 2) {
      const p1 = new THREE.Vector3(ePos.getX(i), ePos.getY(i), ePos.getZ(i));
      const p2 = new THREE.Vector3(ePos.getX(i + 1), ePos.getY(i + 1), ePos.getZ(i + 1));
      const len = p1.distanceTo(p2);
      if (len < 0.005) continue;

      // Tìm các mặt kề với đoạn thẳng (p1, p2)
      const adjNormals = [];
      for (const t of triangles) {
        if (Math.abs(t.norm.dot(p1.clone().sub(t.p0))) < 0.015 &&
            Math.abs(t.norm.dot(p2.clone().sub(t.p0))) < 0.015) {
          if (!adjNormals.some(n => n.dot(t.norm) > 0.95)) {
            adjNormals.push(t.norm);
          }
        }
      }

      // BACK-FACE CULLING:
      // Ít nhất 1 mặt kề phải hướng về phía camera (n.dot(viewDir) < -0.01)
      let hasFacingFace = false;
      for (const n of adjNormals) {
        if (n.dot(viewDir) < -0.01) {
          hasFacingFace = true;
          break;
        }
      }

      if (hasFacingFace) {
        candidateEdges.push({ p1, p2 });
      }
    }

    // SILHOUETTE EDGES: Trích xuất đường biên ngoài của mặt trụ tròn / bo góc cong
    const vKey = (v) => `${Math.round(v.x * 1000)}_${Math.round(v.y * 1000)}_${Math.round(v.z * 1000)}`;
    const edgeMap = new Map();
    for (const t of triangles) {
      const verts = [t.p0, t.p1, t.p2];
      for (let e = 0; e < 3; e++) {
        const a = verts[e];
        const b = verts[(e + 1) % 3];
        const ka = vKey(a);
        const kb = vKey(b);
        if (ka === kb) continue;
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        let entry = edgeMap.get(key);
        if (!entry) {
          entry = { p1: a, p2: b, normals: [] };
          edgeMap.set(key, entry);
        }
        entry.normals.push(t.norm);
      }
    }

    for (const entry of edgeMap.values()) {
      if (entry.normals.length < 2) continue;
      const n0 = entry.normals[0];
      const n1 = entry.normals[1];
      const dotAdj = n0.dot(n1);
      // Chỉ xét cạnh trơn trên mặt cong (góc gập < 25 độ, không đồng phẳng hoàn toàn)
      if (dotAdj > 0.906 && dotAdj < 0.9999) {
        const d0 = n0.dot(viewDir);
        const d1 = n1.dot(viewDir);
        if ((d0 < -0.005 && d1 >= -0.005) || (d1 < -0.005 && d0 >= -0.005)) {
          candidateEdges.push({ p1: entry.p1, p2: entry.p2 });
        }
      }
    }

    return candidateEdges;
  }

  /**
   * Gộp các đoạn thẳng cùng phương và liên tục thành 1 đoạn dài duy nhất (1D Interval Merging)
   */
  mergeCollinear2DLines(lines, EPS_DIST = 0.02, EPS_GAP = 0.05) {
    if (lines.length <= 1) return lines;

    const lineGroups = [];

    for (const seg of lines) {
      const du = seg.p2.u - seg.p1.u;
      const dv = seg.p2.v - seg.p1.v;
      const len = Math.hypot(du, dv);
      if (len < 0.005) continue;

      const dir = { u: du / len, v: dv / len };
      let n = { u: -dir.v, v: dir.u };
      let c = -(n.u * seg.p1.u + n.v * seg.p1.v);

      if (n.u < -1e-6 || (Math.abs(n.u) <= 1e-6 && n.v < 0)) {
        n.u = -n.u;
        n.v = -n.v;
        c = -c;
      }

      let matchedGroup = null;
      for (const g of lineGroups) {
        const dotN = n.u * g.n.u + n.v * g.n.v;
        if (dotN > 0.999 && Math.abs(c - g.c) < EPS_DIST) {
          matchedGroup = g;
          break;
        }
      }

      if (!matchedGroup) {
        matchedGroup = { n, c, dir, intervals: [] };
        lineGroups.push(matchedGroup);
      }

      const t1 = seg.p1.u * matchedGroup.dir.u + seg.p1.v * matchedGroup.dir.v;
      const t2 = seg.p2.u * matchedGroup.dir.u + seg.p2.v * matchedGroup.dir.v;
      matchedGroup.intervals.push({
        min: Math.min(t1, t2),
        max: Math.max(t1, t2)
      });
    }

    const result = [];

    for (const g of lineGroups) {
      if (g.intervals.length === 0) continue;
      g.intervals.sort((a, b) => a.min - b.min);

      const mergedIntervals = [];
      let cur = { min: g.intervals[0].min, max: g.intervals[0].max };

      for (let i = 1; i < g.intervals.length; i++) {
        const next = g.intervals[i];
        if (next.min <= cur.max + EPS_GAP) {
          cur.max = Math.max(cur.max, next.max);
        } else {
          mergedIntervals.push(cur);
          cur = { min: next.min, max: next.max };
        }
      }
      mergedIntervals.push(cur);

      const p0 = { u: -g.c * g.n.u, v: -g.c * g.n.v };
      const t0 = p0.u * g.dir.u + p0.v * g.dir.v;

      for (const inv of mergedIntervals) {
        if (inv.max - inv.min < 0.005) continue;
        const p1 = {
          u: Number((p0.u + (inv.min - t0) * g.dir.u).toFixed(2)),
          v: Number((p0.v + (inv.min - t0) * g.dir.v).toFixed(2))
        };
        const p2 = {
          u: Number((p0.u + (inv.max - t0) * g.dir.u).toFixed(2)),
          v: Number((p0.v + (inv.max - t0) * g.dir.v).toFixed(2))
        };
        result.push({ p1, p2 });
      }
    }

    return result;
  }

  /**
   * True B-Rep Hidden Line Removal (HLR) via OpenCascade / replicad
   */
  projectWithOCCT(shape, viewType, bounds) {
    const { w, h, d } = bounds;
    let camera;
    let offsetU = 0;
    let offsetV = 0;

    if (viewType === 'front') {
      camera = new replicad.ProjectionCamera([0, 0, d + 50], [0, 0, 1], [1, 0, 0]);
    } else if (viewType === 'top') {
      camera = new replicad.ProjectionCamera([0, h + 50, 0], [0, 1, 0], [1, 0, 0]);
      offsetV = d;
    } else {
      camera = new replicad.ProjectionCamera([w + 50, 0, 0], [1, 0, 0], [0, 0, -1]);
      offsetU = d;
    }

    const { visible } = replicad.makeProjectedEdges(shape, camera, false);
    if (!visible || visible.length === 0) {
      return { visible: [], hidden: [] };
    }

    const compound = replicad.compoundShapes(visible);
    const edgeMesh = compound.meshEdges({ tolerance: 0.05, angularTolerance: 0.1 });
    const linesArr = edgeMesh.lines;

    const visibleLines = [];
    for (let i = 0; i < linesArr.length; i += 6) {
      const u1 = Number((linesArr[i] + offsetU).toFixed(3));
      const v1 = Number((linesArr[i + 1] + offsetV).toFixed(3));
      const u2 = Number((linesArr[i + 3] + offsetU).toFixed(3));
      const v2 = Number((linesArr[i + 4] + offsetV).toFixed(3));
      if (Math.hypot(u2 - u1, v2 - v1) > 0.005) {
        visibleLines.push({ p1: { u: u1, v: v1 }, p2: { u: u2, v: v2 } });
      }
    }

    return {
      visible: this.mergeCollinear2DLines(visibleLines),
      hidden: []
    };
  }
}
