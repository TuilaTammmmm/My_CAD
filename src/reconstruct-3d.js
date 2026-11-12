import * as THREE from 'three';
import { Brush, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

/**
 * Reconstruct3DEngine
 * Chuyển đổi bản vẽ 2D (line, arc, circle) thành mô hình khối 3D:
 * 1. Single-View: Extrude (tạo khối mới), Cut (cắt vào khối 3D), Union (ghép thêm)
 * 2. Three-View: Giao 3 hình chiếu (Front ∩ Top ∩ Right)
 */
export class Reconstruct3DEngine {
  constructor(cadEngine) {
    this.cad = cadEngine;
  }

  /**
   * Chuyển đổi các phần tử 2D thành danh sách THREE.Shape (hỗ trợ lỗ rỗng holes bên trong)
   */
  extractShapesFromElements(elements, options = {}) {
    const { includeHidden = false } = options;
    const valid = elements.filter(el => {
      if (!el) return false;
      if (el.type === 'label' || el.type === 'dim' || el.type === 'dim-radial') return false;
      if (el.style === 'guide') return false;
      if (!includeHidden && el.style === 'hidden') return false;
      return el.type === 'line' || el.type === 'arc' || el.type === 'circle';
    });

    if (valid.length === 0) {
      return { shapes: [], error: 'Không có nét vẽ 2D hợp lệ (hãy vẽ nét liền kín).' };
    }

    const polygons = []; // { pts: [{u, v}], area: number }

    // 1. Hình tròn (circle) -> trực tiếp thành đa giác kín
    for (const el of valid) {
      if (el.type === 'circle' && el.r > 0.02) {
        const segs = 48;
        const pts = [];
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * Math.PI * 2;
          pts.push({
            u: el.cx + el.r * Math.cos(a),
            v: el.cy + el.r * Math.sin(a)
          });
        }
        polygons.push({ pts, area: this.computeSignedArea(pts) });
      }
    }

    // 2. Đường thẳng (line) & Cung tròn (arc) -> xây dựng đồ thị phẳng & tìm các vòng kín tối giản
    const rawEdges = [];
    for (const el of valid) {
      if (el.type === 'line') {
        const len = Math.hypot(el.p2.u - el.p1.u, el.p2.v - el.p1.v);
        if (len > 0.01) {
          rawEdges.push({
            p1: { u: el.p1.u, v: el.p1.v },
            p2: { u: el.p2.u, v: el.p2.v },
            interior: []
          });
        }
      } else if (el.type === 'arc' && el.r > 0.02) {
        let sweep = el.endAngle - el.startAngle;
        while (sweep <= 0) sweep += Math.PI * 2;
        if (sweep > Math.PI * 2 - 1e-4) sweep = Math.PI * 2;

        const steps = Math.max(6, Math.ceil(sweep / (Math.PI / 16)));
        const p1 = {
          u: el.cx + el.r * Math.cos(el.startAngle),
          v: el.cy + el.r * Math.sin(el.startAngle)
        };
        const p2 = {
          u: el.cx + el.r * Math.cos(el.endAngle),
          v: el.cy + el.r * Math.sin(el.endAngle)
        };
        const interior = [];
        for (let k = 1; k < steps; k++) {
          const a = el.startAngle + (k / steps) * sweep;
          interior.push({
            u: el.cx + el.r * Math.cos(a),
            v: el.cy + el.r * Math.sin(a)
          });
        }
        rawEdges.push({ p1, p2, interior });
      }
    }

    if (rawEdges.length > 0) {
      const loopPolys = this.findMinimalClosedLoops(rawEdges);
      for (const pts of loopPolys) {
        const area = this.computeSignedArea(pts);
        if (Math.abs(area) > 0.005) {
          polygons.push({ pts, area });
        }
      }
    }

    if (polygons.length === 0) {
      return {
        shapes: [],
        error: 'Chưa tìm thấy biên dạng khép kín! Hãy kiểm tra các góc nối xem có bị hở nét không.'
      };
    }

    // Chuẩn hóa chiều dương (CCW) cho tất cả đa giác
    const normPolys = polygons.map(p => ({
      pts: p.area >= 0 ? p.pts : [...p.pts].reverse(),
      absArea: Math.abs(p.area)
    }));

    // Sắp xếp từ lớn đến nhỏ để xác định lồng nhau (outer shape vs holes)
    normPolys.sort((a, b) => b.absArea - a.absArea);

    const depth = new Array(normPolys.length).fill(0);
    const parentIdx = new Array(normPolys.length).fill(-1);

    for (let i = 0; i < normPolys.length; i++) {
      const testPt = normPolys[i].pts[0];
      for (let j = i - 1; j >= 0; j--) {
        if (this.pointInPolygon(testPt, normPolys[j].pts)) {
          depth[i] = depth[j] + 1;
          parentIdx[i] = j;
          break;
        }
      }
    }

    const shapesMap = new Map();
    const shapes = [];

    for (let i = 0; i < normPolys.length; i++) {
      if (depth[i] % 2 === 0) {
        const shape = this.pointsToShape(normPolys[i].pts);
        shapesMap.set(i, shape);
        shapes.push(shape);
      } else {
        const pIdx = parentIdx[i];
        const parentShape = shapesMap.get(pIdx);
        if (parentShape) {
          const holePts = [...normPolys[i].pts].reverse(); // CW cho lỗ
          parentShape.holes.push(this.pointsToPath(holePts));
        }
      }
    }

    return { shapes, error: null };
  }

  /**
   * Tìm các vòng kín tối giản (Planar Face Traversal) từ tập cạnh line/arc
   */
  findMinimalClosedLoops(rawEdges) {
    const EPS = 0.025;
    const nodes = [];

    const getOrCreateNode = (pt) => {
      for (let i = 0; i < nodes.length; i++) {
        if (Math.hypot(nodes[i].u - pt.u, nodes[i].v - pt.v) <= EPS) {
          return i;
        }
      }
      nodes.push({ u: pt.u, v: pt.v });
      return nodes.length - 1;
    };

    const edges = [];
    for (const re of rawEdges) {
      const n1 = getOrCreateNode(re.p1);
      const n2 = getOrCreateNode(re.p2);
      if (n1 === n2) {
        // Trường hợp vòng tự khép (ví dụ cung 360 độ)
        if (re.interior.length >= 2) {
          edges.push({ n1, n2, interior: re.interior, selfLoop: true });
        }
        continue;
      }
      edges.push({ n1, n2, interior: re.interior, selfLoop: false });
    }

    const closedLoops = [];
    const regularEdges = [];
    for (const e of edges) {
      if (e.selfLoop) {
        closedLoops.push([nodes[e.n1], ...e.interior]);
      } else {
        regularEdges.push(e);
      }
    }

    // Cắt bỏ các đầu thừa (bậc 1) lặp đi lặp lại
    let activeEdges = regularEdges.slice();
    let changed = true;
    while (changed) {
      changed = false;
      const deg = new Array(nodes.length).fill(0);
      for (const e of activeEdges) {
        deg[e.n1]++;
        deg[e.n2]++;
      }
      const nextEdges = activeEdges.filter(e => deg[e.n1] > 1 && deg[e.n2] > 1);
      if (nextEdges.length !== activeEdges.length) {
        activeEdges = nextEdges;
        changed = true;
      }
    }

    if (activeEdges.length < 2) return closedLoops;

    // Tạo half-edges
    const halfEdges = [];
    const outgoing = Array.from({ length: nodes.length }, () => []);

    for (let i = 0; i < activeEdges.length; i++) {
      const e = activeEdges[i];
      const ptsFwd = [nodes[e.n1], ...e.interior, nodes[e.n2]];
      const ptsRev = [...ptsFwd].reverse();

      const outAngleFwd = Math.atan2(ptsFwd[1].v - ptsFwd[0].v, ptsFwd[1].u - ptsFwd[0].u);
      const outAngleRev = Math.atan2(ptsRev[1].v - ptsRev[0].v, ptsRev[1].u - ptsRev[0].u);

      const heFwd = {
        id: halfEdges.length,
        from: e.n1,
        to: e.n2,
        pts: ptsFwd,
        outAngle: outAngleFwd,
        twin: halfEdges.length + 1,
        visited: false
      };
      const heRev = {
        id: halfEdges.length + 1,
        from: e.n2,
        to: e.n1,
        pts: ptsRev,
        outAngle: outAngleRev,
        twin: halfEdges.length,
        visited: false
      };

      halfEdges.push(heFwd, heRev);
      outgoing[e.n1].push(heFwd);
      outgoing[e.n2].push(heRev);
    }

    // Sắp xếp half-edge đi ra ở mỗi đỉnh theo góc tăng dần (CCW)
    for (const list of outgoing) {
      list.sort((a, b) => a.outAngle - b.outAngle);
    }

    // Đi theo quy tắc rẽ trái tối đa để trích xuất các mặt kín bên trong
    for (const startHe of halfEdges) {
      if (startHe.visited) continue;

      const loopPts = [];
      let curr = startHe;
      let steps = 0;
      let validLoop = false;

      while (curr && steps <= halfEdges.length + 2) {
        if (curr.visited) break;
        curr.visited = true;

        // Thêm điểm (bỏ điểm cuối vì trùng điểm đầu cạnh tiếp theo)
        for (let k = 0; k < curr.pts.length - 1; k++) {
          loopPts.push(curr.pts[k]);
        }

        const twin = halfEdges[curr.twin];
        const list = outgoing[curr.to];
        const idx = list.indexOf(twin);
        if (idx === -1 || list.length === 0) break;

        // Half-edge kế tiếp theo chiều CCW (vòng trong có diện tích dương)
        const nextIdx = (idx - 1 + list.length) % list.length;
        curr = list[nextIdx];
        steps++;

        if (curr === startHe) {
          validLoop = true;
          break;
        }
      }

      if (validLoop && loopPts.length >= 3) {
        const area = this.computeSignedArea(loopPts);
        // Chỉ giữ các mặt kín thực (diện tích > 0; mặt vô cực bên ngoài có diện tích âm)
        if (area > 0.005) {
          closedLoops.push(loopPts);
        }
      }
    }

    return closedLoops;
  }

  computeSignedArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.u * b.v - b.u * a.v;
    }
    return area * 0.5;
  }

  pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].u, yi = poly[i].v;
      const xj = poly[j].u, yj = poly[j].v;
      const intersect = ((yi > pt.v) !== (yj > pt.v)) &&
        (pt.u < (xj - xi) * (pt.v - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  pointsToShape(pts) {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].u, pts[0].v);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i].u, pts[i].v);
    }
    shape.closePath();
    return shape;
  }

  pointsToPath(pts) {
    const path = new THREE.Path();
    path.moveTo(pts[0].u, pts[0].v);
    for (let i = 1; i < pts.length; i++) {
      path.lineTo(pts[i].u, pts[i].v);
    }
    path.closePath();
    return path;
  }

  /**
   * Đùn danh sách THREE.Shape thành Brush 3D theo mặt chiếu ('front' | 'top' | 'right')
   * @param {THREE.Shape[]} shapes
   * @param {string} viewPlane - 'front' | 'top' | 'right'
   * @param {number} depth - Chiều dày đùn
   * @param {Object} bounds - { w, h, d }
   * @param {number} extraMargin - Mở rộng 2 đầu khi dùng làm dao cắt/giao
   */
  extrudeShapesToBrush(shapes, viewPlane, depth, bounds = { w: 6, h: 4, d: 4 }, extraMargin = 0, cutFromNearFace = false) {
    const extrudeDepth = Math.max(0.05, depth + extraMargin * 2);
    const geom = new THREE.ExtrudeGeometry(shapes, {
      depth: extrudeDepth,
      bevelEnabled: false,
      curveSegments: 32
    });

    // Đưa hình học về tọa độ chuẩn của My CAD:
    // Front: u=X, v=Y, Z in [0, D]
    // Top:   u=X, v=D-Z (tức Z = D - v), Y in [0, H]
    // Right: u=D-Z (tức Z = D - u), v=Y, X in [0, W]
    const { w: W, h: H, d: D } = bounds;
    if (viewPlane === 'front') {
      const zStart = cutFromNearFace ? (D - depth - extraMargin) : -extraMargin;
      geom.translate(0, 0, zStart);
    } else if (viewPlane === 'top') {
      geom.rotateX(-Math.PI / 2);
      const yStart = cutFromNearFace ? (H - depth - extraMargin) : -extraMargin;
      geom.translate(0, yStart, D);
    } else if (viewPlane === 'right' || viewPlane === 'side') {
      geom.rotateY(Math.PI / 2);
      const xStart = cutFromNearFace ? (W - depth - extraMargin) : -extraMargin;
      geom.translate(xStart, 0, D);
    }

    // Đảm bảo có uv & normal chuẩn cho three-bvh-csg
    if (!geom.attributes.uv) {
      const uvCount = geom.attributes.position.count * 2;
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));
    }
    geom.computeVertexNormals();

    const brush = new Brush(geom, this.cad.material);
    brush.updateMatrixWorld();
    return brush;
  }

  /**
   * 1. Chuyển 1 mặt 2D -> 3D (Tạo khối mới / Cắt vào 3D / Ghép thêm vào 3D)
   */
  reconstructSingleView(elements, { viewPlane = 'front', operation = 'new', depth = 4, bounds = { w: 6, h: 4, d: 4 }, targetBrush = null }) {
    const { shapes, error } = this.extractShapesFromElements(elements);
    if (error || shapes.length === 0) {
      return { brush: null, error: error || 'Không tạo được biên dạng 2D.' };
    }

    if (operation === 'new' || !targetBrush) {
      const newBrush = this.extrudeShapesToBrush(shapes, viewPlane, depth, bounds, 0);
      return { brush: newBrush, error: null };
    }

    // Khi Cắt (cut) hoặc Ghép (add): cắt tính từ mặt nhìn gần nhất (Front +Z, Top +Y, Right +X)
    const isCut = (operation === 'cut');
    const margin = isCut ? 0.2 : 0;
    const toolBrush = this.extrudeShapesToBrush(shapes, viewPlane, depth, bounds, margin, isCut);

    targetBrush.updateMatrixWorld();
    toolBrush.updateMatrixWorld();

    const op = (operation === 'cut') ? SUBTRACTION : ADDITION;
    const result = this.cad.evaluator.evaluate(targetBrush, toolBrush, op);
    result.material = this.cad.material;
    result.geometry.computeVertexNormals();
    toolBrush.geometry.dispose();

    return { brush: result, error: null };
  }

  /**
   * 2. Ghép 3 Hình Chiếu (All 3-View: Top, Front, Right) -> Giao CSG (Front ∩ Top ∩ Right)
   */
  reconstructThreeViews(elements, bounds = { w: 6, h: 4, d: 4 }) {
    const { w: W, h: H, d: D } = bounds;
    const GAP = 2.0;
    const frontYOffset = D + GAP;
    const rightXOffset = W + GAP;
    const TOL = 0.6;

    const topElems = [];
    const frontElems = [];
    const rightElems = [];

    const classifyPoint = (u, v) => {
      if (u <= W + TOL && v <= D + TOL) return 'top';
      if (u <= W + TOL && v >= frontYOffset - TOL) return 'front';
      if (u >= rightXOffset - TOL && v >= frontYOffset - TOL) return 'right';
      return null;
    };

    const cloneWithOffset = (el, du, dv) => {
      if (el.type === 'line') {
        return {
          ...el,
          p1: { u: el.p1.u - du, v: el.p1.v - dv },
          p2: { u: el.p2.u - du, v: el.p2.v - dv }
        };
      }
      if (el.type === 'circle' || el.type === 'arc') {
        return { ...el, cx: el.cx - du, cy: el.cy - dv };
      }
      return null;
    };

    for (const el of elements) {
      if (!el || el.style === 'guide' || el.style === 'hidden') continue;
      if (el.type !== 'line' && el.type !== 'arc' && el.type !== 'circle') continue;

      let refU, refV;
      if (el.type === 'line') {
        refU = (el.p1.u + el.p2.u) / 2;
        refV = (el.p1.v + el.p2.v) / 2;
      } else {
        refU = el.cx;
        refV = el.cy;
      }

      const zone = classifyPoint(refU, refV);
      if (zone === 'top') topElems.push(cloneWithOffset(el, 0, 0));
      else if (zone === 'front') frontElems.push(cloneWithOffset(el, 0, frontYOffset));
      else if (zone === 'right') rightElems.push(cloneWithOffset(el, rightXOffset, frontYOffset));
    }

    const resTop = topElems.length ? this.extractShapesFromElements(topElems) : { shapes: [] };
    const resFront = frontElems.length ? this.extractShapesFromElements(frontElems) : { shapes: [] };
    const resRight = rightElems.length ? this.extractShapesFromElements(rightElems) : { shapes: [] };

    const missing = [];
    if (resFront.shapes.length === 0) missing.push('Front');
    if (resTop.shapes.length === 0) missing.push('Top');
    if (resRight.shapes.length === 0) missing.push('Right');

    const activeBrushes = [];
    if (resFront.shapes.length > 0) {
      activeBrushes.push(this.extrudeShapesToBrush(resFront.shapes, 'front', D + 0.4, bounds, 0.2));
    }
    if (resTop.shapes.length > 0) {
      activeBrushes.push(this.extrudeShapesToBrush(resTop.shapes, 'top', H + 0.4, bounds, 0.2));
    }
    if (resRight.shapes.length > 0) {
      activeBrushes.push(this.extrudeShapesToBrush(resRight.shapes, 'right', W + 0.4, bounds, 0.2));
    }

    if (activeBrushes.length < 2) {
      activeBrushes.forEach(b => b.geometry.dispose());
      return {
        brush: null,
        error: `Cần ít nhất 2 hình chiếu khép kín trong khung All (3-View). Đang thiếu vòng kín ở: ${missing.join(', ')}.`
      };
    }

    let result = activeBrushes[0];
    for (let i = 1; i < activeBrushes.length; i++) {
      result.updateMatrixWorld();
      activeBrushes[i].updateMatrixWorld();
      const next = this.cad.evaluator.evaluate(result, activeBrushes[i], INTERSECTION);
      result.geometry.dispose();
      activeBrushes[i].geometry.dispose();
      result = next;
    }

    result.material = this.cad.material;
    result.geometry.computeVertexNormals();

    const pos = result.geometry.attributes.position;
    if (!pos || pos.count === 0) {
      result.geometry.dispose();
      return {
        brush: null,
        error: '3 hình chiếu không giao nhau tạo thành khối hợp lệ! Hãy kiểm tra lại vị trí căn gióng giữa Front, Top và Right.'
      };
    }

    const warning = missing.length > 0
      ? `Đã dựng từ ${3 - missing.length}/3 hình chiếu (thiếu vòng kín ở: ${missing.join(', ')}).`
      : null;

    return { brush: result, error: null, warning };
  }
}
