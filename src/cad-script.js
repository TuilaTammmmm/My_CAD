import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

const evaluator = new Evaluator();
evaluator.useGroups = false;

function ensureBrush(obj) {
  if (!obj) throw new Error('Đối tượng hình học bị rỗng (null/undefined).');
  if (obj instanceof Brush) {
    const cloned = new Brush(obj.geometry.clone());
    cloned.updateMatrixWorld();
    return cloned;
  }
  if (obj instanceof THREE.BufferGeometry) {
    const b = new Brush(obj.clone());
    b.updateMatrixWorld();
    return b;
  }
  throw new Error('Tham số không phải là khối 3D hợp lệ.');
}

function finalizeGeometry(geom) {
  const nonIndexed = geom.index ? geom.toNonIndexed() : geom;
  if (!nonIndexed.attributes.uv) {
    const count = nonIndexed.attributes.position.count;
    nonIndexed.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

// Khối hộp từ (0, 0, 0) đến (w, h, d)
function box(w, h, d) {
  const geom = new THREE.BoxGeometry(w, h, d);
  geom.translate(w / 2, h / 2, d / 2);
  return new Brush(finalizeGeometry(geom));
}

// Khối hộp bo góc: r có thể là 1 số hoặc mảng 4 góc [r(0,0), r(w,0), r(w,d), r(0,d)]
function roundBox(w, h, d, r = 1, axis = 'y', segments = 24) {
  const radii = Array.isArray(r) ? r : [r, r, r, r];
  const r0 = Math.max(0, radii[0] || 0);
  const r1 = Math.max(0, radii[1] || 0);
  const r2 = Math.max(0, radii[2] || 0);
  const r3 = Math.max(0, radii[3] || 0);

  let uMax = w, vMax = d, depth = h;
  if (axis === 'z') {
    uMax = w; vMax = h; depth = d;
  } else if (axis === 'x') {
    uMax = d; vMax = h; depth = w;
  }

  const shape = new THREE.Shape();
  shape.moveTo(r0, 0);
  shape.lineTo(uMax - r1, 0);
  if (r1 > 0) shape.absarc(uMax - r1, r1, r1, -Math.PI / 2, 0, false);
  shape.lineTo(uMax, vMax - r2);
  if (r2 > 0) shape.absarc(uMax - r2, vMax - r2, r2, 0, Math.PI / 2, false);
  shape.lineTo(r3, vMax);
  if (r3 > 0) shape.absarc(r3, vMax - r3, r3, Math.PI / 2, Math.PI, false);
  shape.lineTo(0, r0);
  if (r0 > 0) shape.absarc(r0, r0, r0, Math.PI, Math.PI * 1.5, false);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: segments
  });

  if (axis === 'y') {
    // Extrude dọc +Z -> xoay để mặt 2D nằm trên XZ (X: 0..w, Z: 0..d) và đùn lên +Y (0..h)
    geom.rotateX(Math.PI / 2);
    geom.translate(0, depth, 0);
  } else if (axis === 'x') {
    geom.rotateY(Math.PI / 2);
  }

  return new Brush(finalizeGeometry(geom));
}

// Khối trụ đặc: mặc định dọc trục Y từ 0..h, tâm XZ tại (0, 0)
function cylinder(r, h, axis = 'y', segments = 48) {
  const geom = new THREE.CylinderGeometry(r, r, h, segments);
  if (axis === 'x') {
    geom.rotateZ(-Math.PI / 2);
    geom.translate(h / 2, 0, 0);
  } else if (axis === 'z') {
    geom.rotateX(Math.PI / 2);
    geom.translate(0, 0, h / 2);
  } else {
    geom.translate(0, h / 2, 0);
  }
  return new Brush(finalizeGeometry(geom));
}

// Ống trụ rỗng
function tube(rOut, rIn, h, axis = 'y', segments = 48) {
  const outer = cylinder(rOut, h, axis, segments);
  const inner = move(
    axis === 'x' ? -0.2 : 0,
    axis === 'y' ? -0.2 : 0,
    axis === 'z' ? -0.2 : 0,
    cylinder(rIn, h + 0.4, axis, segments)
  );
  return cut(outer, inner);
}

// Đùn đa giác 2D: points = [[u1, v1], [u2, v2], ...]
function poly(points, depth, axis = 'y') {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error('poly() cần ít nhất 3 điểm [u, v].');
  }
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    s.lineTo(points[i][0], points[i][1]);
  }
  s.closePath();

  const geom = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  if (axis === 'y') {
    geom.rotateX(Math.PI / 2);
    geom.translate(0, depth, 0);
  } else if (axis === 'x') {
    geom.rotateY(Math.PI / 2);
  }
  return new Brush(finalizeGeometry(geom));
}

// Đùn biên dạng THREE.Shape tùy chỉnh
function shape(buildFn, depth, axis = 'y', segments = 32) {
  const s = new THREE.Shape();
  buildFn(s);
  const geom = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: false,
    curveSegments: segments
  });
  if (axis === 'y') {
    geom.rotateX(Math.PI / 2);
    geom.translate(0, depth, 0);
  } else if (axis === 'x') {
    geom.rotateY(Math.PI / 2);
  }
  return new Brush(finalizeGeometry(geom));
}

function move(x, y, z, obj) {
  const b = ensureBrush(obj);
  b.geometry.translate(x, y, z);
  b.updateMatrixWorld();
  return b;
}

function rotate(rxDeg, ryDeg, rzDeg, obj) {
  const b = ensureBrush(obj);
  const m = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(rxDeg),
      THREE.MathUtils.degToRad(ryDeg),
      THREE.MathUtils.degToRad(rzDeg)
    )
  );
  b.geometry.applyMatrix4(m);
  b.geometry.computeVertexNormals();
  b.updateMatrixWorld();
  return b;
}

function scale(sx, sy, sz, obj) {
  const b = ensureBrush(obj);
  b.geometry.scale(sx, sy, sz);
  b.geometry.computeVertexNormals();
  b.updateMatrixWorld();
  return b;
}

function union(...objs) {
  if (objs.length === 0) throw new Error('union() cần ít nhất 1 khối.');
  let acc = ensureBrush(objs[0]);
  for (let i = 1; i < objs.length; i++) {
    const next = ensureBrush(objs[i]);
    acc = evaluator.evaluate(acc, next, ADDITION);
    acc.updateMatrixWorld();
  }
  return acc;
}

function cut(base, ...cutters) {
  let acc = ensureBrush(base);
  for (const c of cutters) {
    const next = ensureBrush(c);
    acc = evaluator.evaluate(acc, next, SUBTRACTION);
    acc.updateMatrixWorld();
  }
  return acc;
}

function intersect(...objs) {
  if (objs.length === 0) throw new Error('intersect() cần ít nhất 1 khối.');
  let acc = ensureBrush(objs[0]);
  for (let i = 1; i < objs.length; i++) {
    const next = ensureBrush(objs[i]);
    acc = evaluator.evaluate(acc, next, INTERSECTION);
    acc.updateMatrixWorld();
  }
  return acc;
}

export const CAD_SCRIPT_PRESETS = {
  u_shell_pipe: `// Mẫu 1: Vỏ chữ U bo góc 2-R8 / 2-R7 + Trụ rỗng Ø12/Ø10
const outer = roundBox(25, 15, 30, [8, 0, 0, 8]);
const inner = move(1, 1, 1, roundBox(24, 15, 28, [7, 0, 0, 7]));
const pipe  = move(13, 0, 15, cylinder(6, 15));
const hole  = move(13, -1, 15, cylinder(5, 17));
return cut(union(cut(outer, inner), pipe), hole);`,

  horiz_cyl_mount: `// Mẫu 2: Gối đỡ trụ ngang Ø50x90 + Thân 50x35 + Rãnh 18x45 (hướng mặt chính diện ra trước)
const cyl = move(0, 55, 0, cylinder(25, 90, 'x'));
const cylFlat = move(-2, 68, 10, box(94, 20, 20));
const cylTop = cut(cyl, cylFlat);

const web = move(20, 0, 0, box(50, 55, 15));
const base = move(20, 0, 0, box(50, 20, 35));
const body = union(cylTop, web, base);

const webSlot = move(36, -1, -1, box(18, 46, 17));
const baseSlot = move(37, 11, 14, box(16, 11, 23));

return cut(body, webSlot, baseSlot);`,

  starter_block: `// Mẫu 3: Khối bo góc + Khoan lỗ tâm
const base = roundBox(20, 8, 16, 3);
const hole = move(10, -1, 8, cylinder(3, 10));
return cut(base, hole);`
};

export function executeCadScript(code, cadEngine) {
  const fn = new Function(
    'THREE',
    'box',
    'roundBox',
    'cylinder',
    'tube',
    'poly',
    'shape',
    'move',
    'rotate',
    'scale',
    'union',
    'cut',
    'intersect',
    `"use strict";\n${code}`
  );

  const rawResult = fn(
    THREE,
    box,
    roundBox,
    cylinder,
    tube,
    poly,
    shape,
    move,
    rotate,
    scale,
    union,
    cut,
    intersect
  );

  const result = ensureBrush(rawResult);
  result.geometry.computeBoundingBox();
  const bb = result.geometry.boundingBox;
  if (!bb || bb.isEmpty()) {
    throw new Error('Khối 3D kết quả bị rỗng!');
  }

  // Đưa góc nhỏ nhất về (0, 0, 0) để khớp hệ tọa độ lưới của app
  result.geometry.translate(-bb.min.x, -bb.min.y, -bb.min.z);
  result.geometry.computeBoundingBox();
  const nb = result.geometry.boundingBox;

  const w = Math.max(1, Math.round(nb.max.x * 100) / 100);
  const h = Math.max(1, Math.round(nb.max.y * 100) / 100);
  const d = Math.max(1, Math.round(nb.max.z * 100) / 100);

  result.material = cadEngine.material;
  result.geometry.computeVertexNormals();
  result.updateMatrixWorld();

  return { brush: result, w, h, d };
}
