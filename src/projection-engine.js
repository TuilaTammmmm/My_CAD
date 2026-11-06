import * as THREE from 'three';

/**
 * ProjectionEngine
 * Trích xuất 3 hình chiếu vuông góc (Đứng, Bằng, Cạnh) từ mô hình 3D
 * và phân loại chính xác Nét Thấy (Visible) vs Nét Khuất (Hidden)
 */
export class ProjectionEngine {
  constructor(cadEngine) {
    this.cad = cadEngine;
  }

  /**
   * Tính toán 3 hình chiếu của mô hình brush hiện tại
   * @param {THREE.Mesh} brush - Khối 3D hiện tại
   * @param {Object} bounds - Kích thước { w, h, d }
   * @returns {Object} { front, top, side }
   */
  generateProjections(brush, bounds = { w: 6, h: 4, d: 4 }) {
    if (!brush || !brush.geometry) {
      return {
        front: { visible: [], hidden: [] },
        top: { visible: [], hidden: [] },
        side: { visible: [], hidden: [] }
      };
    }

    const { w, h, d } = bounds;

    // Lấy danh sách các đoạn cạnh 3D sắc nét sạch sẽ (đã lọc nét rác)
    const edgeSegments = this.extract3DEdges(brush);

    // Tính toán cho từng hình chiếu
    const front = this.projectOrthographic(edgeSegments, brush, 'front', bounds);
    const top = this.projectOrthographic(edgeSegments, brush, 'top', bounds);
    const side = this.projectOrthographic(edgeSegments, brush, 'side', bounds);

    return { front, top, side, bounds };
  }

  /**
   * Trích xuất các đoạn cạnh 3D (A -> B) từ mesh
   */
  extract3DEdges(brush) {
    const nonIndexed = brush.geometry.index ? brush.geometry.toNonIndexed() : brush.geometry;
    const edgesMesh = this.cad.createEdges(brush);
    const pos = edgesMesh.geometry.attributes.position;
    if (!pos || pos.count === 0) return [];

    const segments = [];
    const step = 0.5; // Bước chia nhỏ cạnh để kiểm tra nét khuất chi tiết từng đoạn

    for (let i = 0; i < pos.count; i += 2) {
      const A = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const B = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      const len = A.distanceTo(B);
      if (len < 0.001) continue;

      // Chia nhỏ cạnh dài thành các phân đoạn 0.5 hoặc 1.0 unit để test che khuất cục bộ
      const numSub = Math.max(1, Math.round(len / step));
      for (let s = 0; s < numSub; s++) {
        const t1 = s / numSub;
        const t2 = (s + 1) / numSub;
        const p1 = new THREE.Vector3().lerpVectors(A, B, t1);
        const p2 = new THREE.Vector3().lerpVectors(A, B, t2);
        segments.push({ p1, p2, mid: new THREE.Vector3().lerpVectors(p1, p2, 0.5) });
      }
    }

    return segments;
  }

  /**
   * Chiếu và phân loại nét thấy/khuất theo hướng chiếu
   * viewType: 'front' (nhìn từ trước +Z), 'top' (nhìn từ trên +Y), 'side' (nhìn từ trái -X -> sang phải)
   */
  projectOrthographic(segments, brush, viewType, bounds) {
    const raycaster = new THREE.Raycaster();
    const visibleLines = [];
    const hiddenLines = [];

    // Hướng nhìn và vector chiếu
    let rayDir, rayOriginFn, map2DFn;

    if (viewType === 'front') {
      // Chiếu Đứng: Nhìn theo trục -Z (từ Z > d về Z = 0)
      // 2D: u = X, v = Y
      rayDir = new THREE.Vector3(0, 0, -1);
      rayOriginFn = (pt) => new THREE.Vector3(pt.x, pt.y, bounds.d + 50);
      map2DFn = (pt) => ({ u: Number(pt.x.toFixed(3)), v: Number(pt.y.toFixed(3)) });

    } else if (viewType === 'top') {
      // Chiếu Bằng: Nhìn theo trục -Y (từ Y > h về Y = 0)
      // 2D: u = X, v = d - Z (để khi nhìn từ trước xuống, mặt trước ở dưới, mặt sau ở trên)
      rayDir = new THREE.Vector3(0, -1, 0);
      rayOriginFn = (pt) => new THREE.Vector3(pt.x, bounds.h + 50, pt.z);
      map2DFn = (pt) => ({ u: Number(pt.x.toFixed(3)), v: Number((bounds.d - pt.z).toFixed(3)) });

    } else if (viewType === 'side') {
      // Chiếu Cạnh (TCVN: nhìn từ Trái sang Phải, đặt bên phải hình chiếu đứng)
      // Nhìn theo trục +X (từ X < 0 về X = w)
      // 2D: u = Z, v = Y
      rayDir = new THREE.Vector3(1, 0, 0);
      rayOriginFn = (pt) => new THREE.Vector3(-50, pt.y, pt.z);
      map2DFn = (pt) => ({ u: Number(pt.z.toFixed(3)), v: Number(pt.y.toFixed(3)) });
    }

    // Raycast kiểm tra từng phân đoạn
    brush.updateMatrixWorld();

    for (const seg of segments) {
      const p1_2d = map2DFn(seg.p1);
      const p2_2d = map2DFn(seg.p2);

      // Nếu đoạn thẳng chiếu thành 1 điểm (vuông góc với mặt chiếu), bỏ qua
      const dist2D = Math.hypot(p2_2d.u - p1_2d.u, p2_2d.v - p1_2d.v);
      if (dist2D < 0.005) continue;

      // Bắn tia từ vô cực về điểm giữa mid
      const origin = rayOriginFn(seg.mid);
      const distToMid = origin.distanceTo(seg.mid);
      raycaster.set(origin, rayDir);
      raycaster.near = 0.1;
      raycaster.far = distToMid + 20;

      const hits = raycaster.intersectObject(brush, false);
      let isVisible = true;

      for (const hit of hits) {
        // Nếu có mặt phẳng nào nằm TRƯỚC điểm giữa (cách xa hơn một ngưỡng epsilon nhỏ)
        if (hit.distance < distToMid - 0.04) {
          isVisible = false;
          break;
        }
      }

      const line2D = { p1: p1_2d, p2: p2_2d };
      if (isVisible) {
        visibleLines.push(line2D);
      } else {
        hiddenLines.push(line2D);
      }
    }

    // Hợp nhất các phân đoạn thẳng liên tục cùng hướng để bản vẽ gọn gàng, không bị phân mảnh
    const mergedVisible = this.mergeCollinearSegments(visibleLines);
    const mergedHidden = this.mergeCollinearSegments(hiddenLines);

    // Loại bỏ các nét khuất trùng hoàn toàn với nét thấy
    const cleanHidden = this.filterHiddenOverlaps(mergedHidden, mergedVisible);

    return {
      visible: mergedVisible,
      hidden: cleanHidden
    };
  }

  /**
   * Gộp các đoạn thẳng thẳng hàng liên tiếp nhau thành một đoạn thẳng duy nhất
   */
  mergeCollinearSegments(lines) {
    if (lines.length <= 1) return lines;

    const EPS = 0.01;
    let list = lines.map(l => ({ ...l, used: false }));
    const result = [];

    for (let i = 0; i < list.length; i++) {
      if (list[i].used) continue;
      let A = list[i].p1;
      let B = list[i].p2;
      list[i].used = true;

      let changed = true;
      while (changed) {
        changed = false;
        const dir = { u: B.u - A.u, v: B.v - A.v };
        const len = Math.hypot(dir.u, dir.v);
        if (len < 0.001) break;
        const normDir = { u: dir.u / len, v: dir.v / len };

        for (let j = 0; j < list.length; j++) {
          if (list[j].used) continue;
          const C = list[j].p1;
          const D = list[j].p2;
          const dirJ = { u: D.u - C.u, v: D.v - C.v };
          const lenJ = Math.hypot(dirJ.u, dirJ.v);
          if (lenJ < 0.001) { list[j].used = true; continue; }
          const normDirJ = { u: dirJ.u / lenJ, v: dirJ.v / lenJ };

          // Kiểm tra xem 2 đoạn thẳng có cùng hướng không
          const dot = Math.abs(normDir.u * normDirJ.u + normDir.v * normDirJ.v);
          if (dot > 0.999) {
            // Kiểm tra xem C hoặc D có chạm A hoặc B không
            const dCA = Math.hypot(C.u - A.u, C.v - A.v);
            const dCB = Math.hypot(C.u - B.u, C.v - B.v);
            const dDA = Math.hypot(D.u - A.u, D.v - A.v);
            const dDB = Math.hypot(D.u - B.u, D.v - B.v);

            if (dCB < EPS) {
              B = D;
              list[j].used = true;
              changed = true;
              break;
            } else if (dDB < EPS) {
              B = C;
              list[j].used = true;
              changed = true;
              break;
            } else if (dCA < EPS) {
              A = D;
              list[j].used = true;
              changed = true;
              break;
            } else if (dDA < EPS) {
              A = C;
              list[j].used = true;
              changed = true;
              break;
            }
          }
        }
      }

      result.push({ p1: A, p2: B });
    }

    return result;
  }

  /**
   * Lọc bỏ những nét khuất bị nét thấy đè lên hoàn toàn
   */
  filterHiddenOverlaps(hiddenLines, visibleLines) {
    const EPS = 0.02;
    return hiddenLines.filter(h => {
      const hMid = { u: (h.p1.u + h.p2.u) / 2, v: (h.p1.v + h.p2.v) / 2 };
      for (const v of visibleLines) {
        // Khoảng cách từ hMid tới đoạn thẳng visible v
        const dist = this.pointToSegmentDistance(hMid, v.p1, v.p2);
        if (dist < EPS) {
          // Nét thấy đã có ở vị trí này, không vẽ nét khuất nữa
          return false;
        }
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
