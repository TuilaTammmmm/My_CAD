import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * ProjectionEngine
 * Trích xuất 3 hình chiếu vuông góc kỹ thuật (Đứng - Front, Bằng - Top, Cạnh - Right/Side)
 * Chuẩn xác tuyệt đối theo TCVN & ISO:
 * - Trích xuất đầy đủ đường bao (Silhouette edges) và các đường gờ sắc nét (Crease edges)
 * - Khắc phục triệt để lỗi mất nét chân biên dạng, hở nét đứt đoạn, cụt nét chéo (5.7 thay vì 6)
 * - Phân loại chính xác Nét Thấy (Visible) vs Nét Khuất (Hidden)
 * - Gộp các phân đoạn thẳng hàng liên tục thành các đoạn thẳng hoàn chỉnh, sạch đẹp, dễ đo đạc
 */
export class ProjectionEngine {
  constructor(cadEngine) {
    this.cad = cadEngine;
  }

  /**
   * Tính toán 3 hình chiếu của mô hình brush hiện tại
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

    const { w, h, d } = bounds;

    const front = this.projectOrthographic(brush, 'front', bounds);
    const top = this.projectOrthographic(brush, 'top', bounds);
    const right = this.projectOrthographic(brush, 'right', bounds);
    const side = right; // Chiếu cạnh (Side/Right view)

    return { front, top, side, right, bounds };
  }

  /**
   * Thực hiện phép chiếu trực giao và phân loại nét thấy / nét khuất
   */
  projectOrthographic(brush, viewType, bounds) {
    const { w, h, d } = bounds;
    let viewDir, rayOriginFn, map2DFn;

    if (viewType === 'front') {
      // 1. Hình Chiếu Đứng (Front): Nhìn theo trục -Z (từ phía trước +Z về Z = 0)
      // 2D: u = X, v = Y (Rộng w x Cao h)
      viewDir = new THREE.Vector3(0, 0, -1);
      rayOriginFn = (pt) => new THREE.Vector3(pt.x, pt.y, d + 50);
      map2DFn = (pt) => ({ u: Number(pt.x.toFixed(3)), v: Number(pt.y.toFixed(3)) });

    } else if (viewType === 'top') {
      // 2. Hình Chiếu Bằng (Top): Nhìn từ trên cao +Y xuống Y = 0
      // 2D: u = X, v = d - Z (Mặt trước Z=d ở dưới, mặt sau Z=0 ở trên) (Rộng w x Sâu d)
      viewDir = new THREE.Vector3(0, -1, 0);
      rayOriginFn = (pt) => new THREE.Vector3(pt.x, h + 50, pt.z);
      map2DFn = (pt) => ({ u: Number(pt.x.toFixed(3)), v: Number((d - pt.z).toFixed(3)) });

    } else if (viewType === 'right' || viewType === 'side') {
      // 3. Hình Chiếu Cạnh (Right View): Nhìn từ bên phải +X về X = 0
      // 2D: u = d - Z (Mặt trước Z=d ở bên trái người nhìn, mặt sau Z=0 ở bên phải), v = Y (Sâu d x Cao h)
      viewDir = new THREE.Vector3(-1, 0, 0);
      rayOriginFn = (pt) => new THREE.Vector3(w + 50, pt.y, pt.z);
      map2DFn = (pt) => ({ u: Number((d - pt.z).toFixed(3)), v: Number(pt.y.toFixed(3)) });
    }

    // Trích xuất các cạnh ứng viên (crease edges + boundary + silhouette edges của hướng nhìn)
    const candidateEdges = this.extractCandidateEdges(brush.geometry, viewDir);

    brush.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    const visibleSegments = [];
    const hiddenSegments = [];

    const nonIndexed = brush.geometry.index ? brush.geometry.toNonIndexed() : brush.geometry;
    const pos = nonIndexed.attributes.position;

    // Kiểm tra từng cạnh
    for (const edge of candidateEdges) {
      const p1_2d = map2DFn(edge.p1);
      const p2_2d = map2DFn(edge.p2);
      const len2D = Math.hypot(p2_2d.u - p1_2d.u, p2_2d.v - p1_2d.v);
      if (len2D < 0.005) continue; // Cạnh vuông góc mặt phẳng chiếu (chiếu thành 1 điểm)

      const len3D = edge.p1.distanceTo(edge.p2);
      // Chia nhỏ cạnh để kiểm tra nét khuất cục bộ (tối đa 8 đoạn)
      const numSub = Math.max(1, Math.min(8, Math.round(len3D / 0.5)));

      for (let s = 0; s < numSub; s++) {
        const t1 = s / numSub;
        const t2 = (s + 1) / numSub;
        const subP1_3D = new THREE.Vector3().lerpVectors(edge.p1, edge.p2, t1);
        const subP2_3D = new THREE.Vector3().lerpVectors(edge.p1, edge.p2, t2);
        const mid3D = new THREE.Vector3().lerpVectors(subP1_3D, subP2_3D, 0.5);

        const subP1_2D = map2DFn(subP1_3D);
        const subP2_2D = map2DFn(subP2_3D);

        // Bắn tia kiểm tra che khuất
        const origin = rayOriginFn(mid3D);
        const distToMid = origin.distanceTo(mid3D);
        raycaster.set(origin, viewDir);
        raycaster.near = 0.1;
        raycaster.far = distToMid + 20;

        const hits = raycaster.intersectObject(brush, false);
        let isOccluded = false;

        for (const hit of hits) {
          // Chỉ coi là che khuất nếu mặt chắn nằm trước ít nhất 0.06 đơn vị
          if (hit.distance < distToMid - 0.06) {
            const f = hit.face;
            if (f) {
              // Kiểm tra xem tam giác bị va chạm có chứa hoặc liền kề với cạnh này không
              const vA = new THREE.Vector3(pos.getX(f.a), pos.getY(f.a), pos.getZ(f.a));
              const vB = new THREE.Vector3(pos.getX(f.b), pos.getY(f.b), pos.getZ(f.b));
              const vC = new THREE.Vector3(pos.getX(f.c), pos.getY(f.c), pos.getZ(f.c));

              const touchesEdge =
                vA.distanceTo(edge.p1) < 0.02 || vB.distanceTo(edge.p1) < 0.02 || vC.distanceTo(edge.p1) < 0.02 ||
                vA.distanceTo(edge.p2) < 0.02 || vB.distanceTo(edge.p2) < 0.02 || vC.distanceTo(edge.p2) < 0.02;

              // Nếu không phải là mặt kề của cạnh và mặt đó hướng về camera
              if (!touchesEdge && f.normal.dot(viewDir) < -0.05) {
                isOccluded = true;
                break;
              }
            } else {
              isOccluded = true;
              break;
            }
          }
        }

        const seg = { p1: subP1_2D, p2: subP2_2D };
        if (isOccluded) {
          hiddenSegments.push(seg);
        } else {
          visibleSegments.push(seg);
        }
      }
    }

    // Gộp các phân đoạn thẳng hàng 1D chính xác tuyệt đối
    const mergedVisible = this.mergeCollinear2DLines(visibleSegments);
    const mergedHidden = this.mergeCollinear2DLines(hiddenSegments);

    // Lọc bỏ nét khuất bị nét thấy đè lên
    const cleanHidden = this.filterHiddenOverlaps(mergedHidden, mergedVisible);

    return {
      visible: mergedVisible,
      hidden: cleanHidden
    };
  }

  /**
   * Trích xuất các cạnh hình học có nghĩa (đường viền phôi, gờ sắc nhọn, và đường biên silhouette)
   */
  extractCandidateEdges(geometry, viewDir) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const merged = mergeVertices(nonIndexed, 0.001);
    const pos = merged.attributes.position;
    const index = merged.index;

    const edgeMap = new Map();
    const triCount = index ? index.count / 3 : pos.count / 3;

    const getV = (i) => {
      const idx = index ? index.getX(i) : i;
      return new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
    };

    for (let i = 0; i < triCount; i++) {
      const v0 = getV(i * 3);
      const v1 = getV(i * 3 + 1);
      const v2 = getV(i * 3 + 2);

      const cb = new THREE.Vector3().subVectors(v2, v1);
      const ab = new THREE.Vector3().subVectors(v0, v1);
      cb.cross(ab);
      if (cb.length() < 1e-7) continue;
      const normal = cb.normalize();

      const addEdge = (va, vb) => {
        const kA = `${va.x.toFixed(3)},${va.y.toFixed(3)},${va.z.toFixed(3)}`;
        const kB = `${vb.x.toFixed(3)},${vb.y.toFixed(3)},${vb.z.toFixed(3)}`;
        const key = kA < kB ? `${kA}_${kB}` : `${kB}_${kA}`;

        if (!edgeMap.has(key)) {
          edgeMap.set(key, { p1: va, p2: vb, normals: [normal] });
        } else {
          edgeMap.get(key).normals.push(normal);
        }
      };

      addEdge(v0, v1);
      addEdge(v1, v2);
      addEdge(v2, v0);
    }

    const candidateEdges = [];
    const thresholdCos = Math.cos(THREE.MathUtils.degToRad(5)); // Góc nhị diện > 5 độ

    for (const [, edge] of edgeMap.entries()) {
      if (edge.normals.length === 1) {
        // Cạnh biên ngoài hở (Boundary edge)
        candidateEdges.push({ p1: edge.p1, p2: edge.p2 });
      } else {
        const n0 = edge.normals[0];
        let isCrease = false;
        let isSilhouette = false;

        for (let j = 1; j < edge.normals.length; j++) {
          const nj = edge.normals[j];
          if (n0.dot(nj) < thresholdCos) {
            isCrease = true;
          }
          const d1 = n0.dot(viewDir);
          const d2 = nj.dot(viewDir);
          if ((d1 < -1e-4 && d2 >= -1e-4) || (d2 < -1e-4 && d1 >= -1e-4)) {
            isSilhouette = true;
          }
        }

        if (isCrease || isSilhouette) {
          candidateEdges.push({ p1: edge.p1, p2: edge.p2 });
        }
      }
    }

    return candidateEdges;
  }

  /**
   * Gộp các đoạn thẳng cùng phương và liên tục thành 1 đoạn dài duy nhất (1D Interval Merging)
   * Đảm bảo không bị cụt nét, không bị gián đoạn giữa chừng
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
   * Lọc bỏ những nét khuất bị nét thấy đè lên hoàn toàn
   */
  filterHiddenOverlaps(hiddenLines, visibleLines) {
    const EPS = 0.03;
    return hiddenLines.filter(h => {
      const hMid = { u: (h.p1.u + h.p2.u) / 2, v: (h.p1.v + h.p2.v) / 2 };
      for (const v of visibleLines) {
        const dist = this.pointToSegmentDistance(hMid, v.p1, v.p2);
        if (dist < EPS) return false;
      }
      return true;
    });
  }

  pointToSegmentDistance(p, a, b) {
    const ab = { u: b.u - a.u, v: b.v - a.v };
    const ap = { u: p.u - a.u, v: p.v - a.v };
    const l2 = ab.u * ab.u + ab.v * ab.v;
    if (l2 < 1e-6) return Math.hypot(p.u - a.u, p.v - a.v);
    let t = Math.max(0, Math.min(1, (ap.u * ab.u + ap.v * ab.v) / l2));
    const proj = { u: a.u + t * ab.u, v: a.v + t * ab.v };
    return Math.hypot(p.u - proj.u, p.v - proj.v);
  }
}
