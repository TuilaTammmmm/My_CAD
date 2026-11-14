import { initOCCT, replicad, replicadToBrush } from './occt-kernel.js';
import { Brush } from 'three-bvh-csg';

export const CAD_SCRIPT_PRESETS = {
  starter_block: `// Phôi hộp 60x40x50 bo cạnh R3 + khoan lỗ Ø20 (Cú pháp ngắn gọn)
const phoi = hop(60, 40, 50).bo(3);
const loKhoan = tru(10, 60, 'y');

return phoi.khoet(loKhoan);`,

  new_box_cut: `// 1. Tạo phôi hộp theo kích thước W x H x D
let phoi = hop(W, H, D);

// 2. Tạo lỗ tròn và rãnh cắt mẫu bằng cú pháp tiếng Việt:
const rHole = Math.max(0.5, Number((Math.min(W, D) * 0.18).toFixed(2)));
const loTam = tru(rHole, H + 4, 'y');
const ranh = hop(W * 0.35, H * 0.25, D + 4).dich(0, H * 0.38, 0);

return phoi.khoet(loTam, ranh);`,

  empty_box: `// Phôi hộp mới tinh (W x H x D) để bắt đầu cắt gọt
return hop(W, H, D);`,

  u_shell_pipe: `// Khối chữ U bo tròn + 2 ống trụ ngang (OpenCascade B-Rep)
const thanU = hop_bo(50, 50, 50, 8);
const khoetTrong = hop_bo(34, 42, 56, 4).dich(0, 8, 0);
let voU = thanU.khoet(khoetTrong);

// 2 ống trụ ngang xuyên suốt:
const ongTrai = ong(12, 6, 30, 'x').dich(-25, 8, 0);
const ongPhai = ong(12, 6, 30, 'x').dich(25, 8, 0);

// Cắt thông lòng ống vào thân U:
const loThongL = tru(6, 36, 'x').dich(-22, 8, 0);
const loThongR = tru(6, 36, 'x').dich(22, 8, 0);

return voU.ghep(ongTrai, ongPhai).khoet(loThongL, loThongR);`,

  horiz_cyl_mount: `// Trụ nằm ngang Ø50×90 + Vách đứng 50×35×15 + Đế dưới 50×20×35
const truNgang = tru(25, 90, 'x').dich(0, 55, 0);
const vachDung = hop(50, 35, 15).dich(0, 37.5, 7.5);
const deDuoi   = hop(50, 20, 35).dich(0, 10, 17.5);

return truNgang.ghep(vachDung, deDuoi);`,

  mount_with_boss_slot: `// Gối đỡ đế 60x80x30 + Trụ tròn Ø30x30 + Hầm 40x20 + Vấu 30x10 + Vát 52x42
// 1. Đế chính
let de = hop(60, 30, 80);

// 2. Rãnh hầm khoét xuyên suốt mặt đáy
const ham = hop(70, 20, 40).dich(0, -5, 0);
de = de.khoet(ham);

// 3. Vấu vuông lồi ra phía trước
const vau = hop(30, 28, 10).dich(0, -1, -45);
let res = de.ghep(vau);

// 4. Bậc hạ phía sau
const bacSau = hop(70, 16, 28).dich(0, 8, 40);
res = res.khoet(bacSau);

// 5. Cắt vát nghiêng 2 bên
const daoVatL = hop(30, 30, 60).xoay(0, 0, 45).dich(-30, 20, -5);
const daoVatR = hop(30, 30, 60).xoay(0, 0, -45).dich(30, 20, -5);
res = res.khoet(daoVatL, daoVatR);

// 6. Trụ tròn đỉnh Ø30 x Cao 30
const truDinh = tru(15, 30, 'y').dich(0, 30, -5);
return res.ghep(truDinh);`
};

function getNativeMethod(obj, name) {
  let proto = Object.getPrototypeOf(obj);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (desc && typeof desc.value === 'function') {
      return desc.value;
    }
    proto = Object.getPrototypeOf(proto);
  }
  if (typeof obj[name] === 'function') return obj[name];
  return null;
}

function nativeClone(shape) {
  const fn = getNativeMethod(shape, 'clone');
  return fn ? fn.call(shape) : shape;
}

function nativeTranslate(shape, x, y, z) {
  const fn = getNativeMethod(shape, 'translate');
  if (!fn) throw new Error('Đối tượng không hỗ trợ translate');
  return fn.call(shape, [x, y, z]);
}

function nativeRotate(shape, angle, position, direction) {
  const fn = getNativeMethod(shape, 'rotate');
  if (!fn) throw new Error('Đối tượng không hỗ trợ rotate');
  return fn.call(shape, angle, position, direction);
}

function nativeScale(shape, factor, center = [0, 0, 0]) {
  const fn = getNativeMethod(shape, 'scale');
  if (!fn) throw new Error('Đối tượng không hỗ trợ scale');
  return fn.call(shape, factor, center);
}

function nativeFuse(shape, other) {
  const fn = getNativeMethod(shape, 'fuse');
  if (!fn) throw new Error('Đối tượng không hỗ trợ union/fuse');
  return fn.call(shape, other);
}

function nativeCut(shape, tool) {
  const fn = getNativeMethod(shape, 'cut');
  if (!fn) throw new Error('Đối tượng không hỗ trợ cut');
  return fn.call(shape, tool);
}

function nativeIntersect(shape, other) {
  const fn = getNativeMethod(shape, 'intersect');
  if (!fn) throw new Error('Đối tượng không hỗ trợ intersect');
  return fn.call(shape, other);
}

function nativeFillet(shape, radius, filter) {
  const fn = getNativeMethod(shape, 'fillet');
  if (!fn) throw new Error('Đối tượng không hỗ trợ fillet');
  return filter ? fn.call(shape, radius, filter) : fn.call(shape, radius);
}

function nativeChamfer(shape, dist, filter) {
  const fn = getNativeMethod(shape, 'chamfer');
  if (!fn) throw new Error('Đối tượng không hỗ trợ chamfer');
  return filter ? fn.call(shape, dist, filter) : fn.call(shape, dist);
}

function wrapShape(shape) {
  if (!shape) return shape;
  shape.dich = (x = 0, y = 0, z = 0) => move(shape, x, y, z);
  shape.move = shape.dich;
  shape.xoay = (rx = 0, ry = 0, rz = 0) => rotate(shape, rx, ry, rz);
  shape.khoet = (...cutters) => cut(shape, ...cutters);
  shape.cat = shape.khoet;
  shape.ghep = (...others) => union(shape, ...others);
  shape.hop_nhat = shape.ghep;
  shape.bo = (r, filter) => fillet(shape, r, filter);
  shape.vat = (d, filter) => chamfer(shape, d, filter);
  return shape;
}

function box(w, h, d) {
  return wrapShape(replicad.makeBox([-w / 2, -h / 2, -d / 2], [w / 2, h / 2, d / 2]));
}

function roundBox(w, h, d, r = 4) {
  const b = box(w, h, d);
  const maxR = Math.min(w, h, d) * 0.45;
  const rad = Math.max(0.05, Math.min(r, maxR));
  return fillet(b, rad);
}

function cylinder(r, h, axis = 'y') {
  const ax = axis.toLowerCase();
  let s;
  if (ax === 'x') {
    s = replicad.makeCylinder(r, h, [-h / 2, 0, 0], [1, 0, 0]);
  } else if (ax === 'z') {
    s = replicad.makeCylinder(r, h, [0, 0, -h / 2], [0, 0, 1]);
  } else {
    s = replicad.makeCylinder(r, h, [0, -h / 2, 0], [0, 1, 0]);
  }
  return wrapShape(s);
}

function tube(rOuter, rInner, h, axis = 'y') {
  const outer = cylinder(rOuter, h, axis);
  const inner = cylinder(rInner, h + 1, axis);
  return cut(outer, inner);
}

function poly(points2D, depth, axis = 'z') {
  if (!points2D || points2D.length < 3) {
    throw new Error('poly() cần ít nhất 3 điểm [x, y]');
  }
  const pen = replicad.draw(points2D[0]);
  for (let i = 1; i < points2D.length; i++) {
    pen.lineTo(points2D[i]);
  }
  const drawing = pen.close();
  const ax = axis.toLowerCase();
  let s;
  if (ax === 'x') {
    s = drawing.sketchOnPlane('YZ', -depth / 2).extrude(depth);
  } else if (ax === 'y') {
    s = drawing.sketchOnPlane('XZ', -depth / 2).extrude(depth);
  } else {
    s = drawing.sketchOnPlane('XY', -depth / 2).extrude(depth);
  }
  return wrapShape(s);
}

function move(target, x = 0, y = 0, z = 0) {
  if (!target) return target;
  const cloned = nativeClone(target);
  return wrapShape(nativeTranslate(cloned, x, y, z));
}

function rotate(target, rxDeg = 0, ryDeg = 0, rzDeg = 0) {
  if (!target) return target;
  let res = nativeClone(target);
  if (rxDeg) res = nativeRotate(res, rxDeg, [0, 0, 0], [1, 0, 0]);
  if (ryDeg) res = nativeRotate(res, ryDeg, [0, 0, 0], [0, 1, 0]);
  if (rzDeg) res = nativeRotate(res, rzDeg, [0, 0, 0], [0, 0, 1]);
  return wrapShape(res);
}

function scale(target, sx = 1) {
  if (!target) return target;
  const cloned = nativeClone(target);
  return wrapShape(nativeScale(cloned, sx, [0, 0, 0]));
}

function union(...items) {
  const flat = items.flat().filter(Boolean);
  if (flat.length === 0) throw new Error('union() cần ít nhất 1 khối');
  let res = nativeClone(flat[0]);
  for (let i = 1; i < flat.length; i++) {
    res = nativeFuse(res, flat[i]);
  }
  return wrapShape(res);
}

function cut(target, ...cutters) {
  const flat = cutters.flat().filter(Boolean);
  if (!target) throw new Error('cut() cần khối gốc');
  let res = nativeClone(target);
  for (const c of flat) {
    res = nativeCut(res, c);
  }
  return wrapShape(res);
}

function intersect(target, ...others) {
  const flat = others.flat().filter(Boolean);
  if (!target) throw new Error('intersect() cần khối gốc');
  let res = nativeClone(target);
  for (const o of flat) {
    res = nativeIntersect(res, o);
  }
  return wrapShape(res);
}

function fillet(target, radius, filter) {
  if (!target) return target;
  const cloned = nativeClone(target);
  return wrapShape(nativeFillet(cloned, radius, filter));
}

function chamfer(target, dist, filter) {
  if (!target) return target;
  const cloned = nativeClone(target);
  return wrapShape(nativeChamfer(cloned, dist, filter));
}

function shell(target, thickness, faceFilter) {
  if (!target) return target;
  const fn = getNativeMethod(target, 'shell');
  if (!fn) throw new Error('Đối tượng không hỗ trợ shell');
  const cloned = nativeClone(target);
  return wrapShape(fn.call(cloned, thickness, faceFilter));
}

/**
 * Compile and run a user CAD script on the OpenCascade (replicad) B-Rep kernel.
 * Returns { brush, w, h, d } aligned to [0..W, 0..H, 0..D].
 */
export async function executeCadScript(code, cadEngine, dims = { w: 6, h: 4, d: 4 }) {
  await initOCCT();

  const W = Number(dims?.w) > 0 ? Number(dims.w) : 6;
  const H = Number(dims?.h) > 0 ? Number(dims.h) : 4;
  const D = Number(dims?.d) > 0 ? Number(dims.d) : 4;

  const helpers = {
    W,
    H,
    D,
    baseBox: (w = W, h = H, d = D) => box(w, h, d),
    box,
    hop: box,
    roundBox,
    hop_bo: roundBox,
    cylinder,
    tru: cylinder,
    tube,
    ong: tube,
    poly,
    shape: poly,
    move,
    dich: move,
    rotate,
    xoay: rotate,
    scale,
    union,
    ghep: union,
    hop_nhat: union,
    fuse: union,
    cut,
    khoet: cut,
    cat: cut,
    intersect,
    fillet,
    bo: fillet,
    chamfer,
    vat: chamfer,
    shell,
    replicad
  };

  const argNames = Object.keys(helpers);
  const argVals = Object.values(helpers);
  const fn = new Function(...argNames, `"use strict";\n${code}`);
  const result = fn(...argVals);

  if (!result || typeof result.mesh !== 'function' || !result.boundingBox) {
    throw new Error('Script phải trả về 1 khối 3D replicad (ví dụ: return cut(a, b);)');
  }

  const rotDeg = Number(dims?.frontRotDeg) || 0;
  let finalShape = nativeClone(result);
  if (rotDeg !== 0) {
    finalShape = nativeRotate(finalShape, rotDeg, [0, 0, 0], [0, 1, 0]);
  }

  const bounds = finalShape.boundingBox.bounds;
  const minX = bounds[0][0], minY = bounds[0][1], minZ = bounds[0][2];
  const maxX = bounds[1][0], maxY = bounds[1][1], maxZ = bounds[1][2];

  const alignedShape = nativeTranslate(finalShape, -minX, -minY, -minZ);
  const w = Math.max(1, Math.round((maxX - minX) * 100) / 100);
  const h = Math.max(1, Math.round((maxY - minY) * 100) / 100);
  const d = Math.max(1, Math.round((maxZ - minZ) * 100) / 100);

  const brush = replicadToBrush(alignedShape, cadEngine.material);
  return { brush, w, h, d };
}

/**
 * Rotate an existing brush around the Y axis by `deg` degrees (e.g. +90)
 * and re-align its bounding box to [0..W, 0..H, 0..D].
 * Supports both OpenCascade B-Rep shapes and Three.js / CSG mesh brushes.
 */
export async function rotateBrushAroundY(brush, cadEngine, deg = 90) {
  if (!brush || !brush.geometry) {
    throw new Error('Không có khối để xoay');
  }

  // 1. Nếu có B-Rep shape từ OpenCascade, thử xoay bằng OCCT trước
  if (brush._replicadShape) {
    try {
      await initOCCT();
      const rotated = brush._replicadShape.clone().rotate(deg, [0, 0, 0], [0, 1, 0]);
      const bounds = rotated.boundingBox.bounds;
      const minX = bounds[0][0], minY = bounds[0][1], minZ = bounds[0][2];
      const maxX = bounds[1][0], maxY = bounds[1][1], maxZ = bounds[1][2];
      const aligned = rotated.translate(-minX, -minY, -minZ);
      const w = Math.max(1, Math.round((maxX - minX) * 100) / 100);
      const h = Math.max(1, Math.round((maxY - minY) * 100) / 100);
      const d = Math.max(1, Math.round((maxZ - minZ) * 100) / 100);
      const nextBrush = replicadToBrush(aligned, cadEngine.material);
      return { brush: nextBrush, w, h, d };
    } catch (err) {
      console.warn('OCCT rotate failed, falling back to mesh rotation:', err);
    }
  }

  // 2. Xoay trực tiếp hình học BufferGeometry (hỗ trợ mọi khối CSG / Three.js)
  const geom = brush.geometry.clone();
  geom.rotateY((deg * Math.PI) / 180);
  geom.computeBoundingBox();
  const min = geom.boundingBox.min;
  geom.translate(-min.x, -min.y, -min.z);
  geom.computeBoundingBox();
  geom.computeVertexNormals();
  try {
    if (geom.computeBoundsTree) geom.computeBoundsTree();
  } catch (e) {}

  const w = Math.max(1, Math.round(geom.boundingBox.max.x * 100) / 100);
  const h = Math.max(1, Math.round(geom.boundingBox.max.y * 100) / 100);
  const d = Math.max(1, Math.round(geom.boundingBox.max.z * 100) / 100);

  const nextBrush = new Brush(geom, cadEngine.material);
  nextBrush.updateMatrixWorld();
  if (brush.userData) {
    nextBrush.userData = { ...brush.userData };
    delete nextBrush.userData.isBRep;
    delete nextBrush.userData.occtEdges;
  }
  delete nextBrush._occtEdges;
  return { brush: nextBrush, w, h, d };
}
