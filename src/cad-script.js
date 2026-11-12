import { initOCCT, replicad, replicadToBrush } from './occt-kernel.js';

export const CAD_SCRIPT_PRESETS = {
  new_box_cut: `// 1. Tạo sẵn phôi hộp mới theo kích thước W x H x D hiện tại
let phoi = box(W, H, D);

// 2. Tạo dao cắt mẫu (bạn có thể sửa/xóa để giữ nguyên hộp hoặc cắt thêm)
const rHole = Math.max(0.5, Number((Math.min(W, D) * 0.18).toFixed(2)));
const loTam = cylinder(rHole, H + 4, 'y');
const ranh = move(box(W * 0.35, H * 0.25, D + 4), 0, H * 0.38, 0);

return cut(phoi, loTam, ranh);`,

  empty_box: `// Tạo sẵn 1 phôi hộp mới tinh (W x H x D) để cắt gọt tiếp
const phoi = box(W, H, D);
return phoi;`,

  u_shell_pipe: `// Khối chữ U bo tròn + 2 ống trụ ngang (OpenCascade B-Rep)
const uOuter = roundBox(50, 50, 50, 8);
const uInner = move(roundBox(34, 42, 56, 4), 0, 8, 0);
const uBody = cut(uOuter, uInner);

// 2 ống trụ ngang xuyên suốt (B-Rep mặt cong thật)
const pipeL = move(tube(12, 6, 30, 'x'), -25, 8, 0);
const pipeR = move(tube(12, 6, 30, 'x'),  25, 8, 0);

// Cắt thông lòng ống vào thân U
const holeL = move(cylinder(6, 36, 'x'), -22, 8, 0);
const holeR = move(cylinder(6, 36, 'x'),  22, 8, 0);

let res = union(uBody, pipeL, pipeR);
res = cut(res, holeL, holeR);
return res;`,

  horiz_cyl_mount: `// Đề bài: Trụ nằm ngang Ø50 dài 90 + Đế 50x35 cắt rãnh (OpenCascade B-Rep)
const cyl = move(cylinder(25, 90, 'x'), 0, 55, 0);
const topSlot = move(box(50, 14, 12), 0, 55 + 25 - 5, 0);

const base = move(box(50, 45, 35), 0, 22.5, 0);
const frontCut = move(box(16, 15, 38), 0, 20 - 9 + 7.5, 0);
const backCut = move(box(18, 45, 16), 0, 22.5, -10);

return cut(union(cyl, base), topSlot, frontCut, backCut);`,

  starter_block: `// Phôi hộp 60x40x50 bo cạnh R3 + khoan lỗ Ø20 (OpenCascade B-Rep)
const block = fillet(box(60, 40, 50), 3);
const hole = cylinder(10, 60, 'y');
return cut(block, hole);`
};

function box(w, h, d) {
  return replicad.makeBox([-w / 2, -h / 2, -d / 2], [w / 2, h / 2, d / 2]);
}

function roundBox(w, h, d, r = 4) {
  const b = box(w, h, d);
  const maxR = Math.min(w, h, d) * 0.45;
  const rad = Math.max(0.05, Math.min(r, maxR));
  return b.fillet(rad);
}

function cylinder(r, h, axis = 'y') {
  const ax = axis.toLowerCase();
  if (ax === 'x') {
    return replicad.makeCylinder(r, h, [-h / 2, 0, 0], [1, 0, 0]);
  }
  if (ax === 'z') {
    return replicad.makeCylinder(r, h, [0, 0, -h / 2], [0, 0, 1]);
  }
  return replicad.makeCylinder(r, h, [0, -h / 2, 0], [0, 1, 0]);
}

function tube(rOuter, rInner, h, axis = 'y') {
  const outer = cylinder(rOuter, h, axis);
  const inner = cylinder(rInner, h + 1, axis);
  return outer.cut(inner);
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
  if (ax === 'x') {
    return drawing.sketchOnPlane('YZ', -depth / 2).extrude(depth);
  }
  if (ax === 'y') {
    return drawing.sketchOnPlane('XZ', -depth / 2).extrude(depth);
  }
  return drawing.sketchOnPlane('XY', -depth / 2).extrude(depth);
}

function move(target, x = 0, y = 0, z = 0) {
  return target.clone().translate(x, y, z);
}

function rotate(target, rxDeg = 0, ryDeg = 0, rzDeg = 0) {
  let res = target.clone();
  if (rxDeg) res = res.rotate(rxDeg, [0, 0, 0], [1, 0, 0]);
  if (ryDeg) res = res.rotate(ryDeg, [0, 0, 0], [0, 1, 0]);
  if (rzDeg) res = res.rotate(rzDeg, [0, 0, 0], [0, 0, 1]);
  return res;
}

function scale(target, sx = 1) {
  return target.clone().scale(sx, [0, 0, 0]);
}

function union(...items) {
  const flat = items.flat().filter(Boolean);
  if (flat.length === 0) throw new Error('union() cần ít nhất 1 khối');
  let res = flat[0].clone();
  for (let i = 1; i < flat.length; i++) {
    res = res.fuse(flat[i]);
  }
  return res;
}

function cut(target, ...cutters) {
  const flat = cutters.flat().filter(Boolean);
  if (!target) throw new Error('cut() cần khối gốc');
  let res = target.clone();
  for (const c of flat) {
    res = res.cut(c);
  }
  return res;
}

function intersect(target, ...others) {
  const flat = others.flat().filter(Boolean);
  if (!target) throw new Error('intersect() cần khối gốc');
  let res = target.clone();
  for (const o of flat) {
    res = res.intersect(o);
  }
  return res;
}

function fillet(target, radius, filter) {
  return filter ? target.fillet(radius, filter) : target.fillet(radius);
}

function chamfer(target, dist, filter) {
  return filter ? target.chamfer(dist, filter) : target.chamfer(dist);
}

function shell(target, thickness, faceFilter) {
  return target.shell(thickness, faceFilter);
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
    roundBox,
    cylinder,
    tube,
    poly,
    shape: poly,
    move,
    rotate,
    scale,
    union,
    fuse: union,
    cut,
    intersect,
    fillet,
    chamfer,
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

  const bounds = result.boundingBox.bounds;
  const minX = bounds[0][0], minY = bounds[0][1], minZ = bounds[0][2];
  const maxX = bounds[1][0], maxY = bounds[1][1], maxZ = bounds[1][2];

  const alignedShape = result.clone().translate(-minX, -minY, -minZ);
  const w = Math.max(1, Math.round((maxX - minX) * 100) / 100);
  const h = Math.max(1, Math.round((maxY - minY) * 100) / 100);
  const d = Math.max(1, Math.round((maxZ - minZ) * 100) / 100);

  const brush = replicadToBrush(alignedShape, cadEngine.material);
  return { brush, w, h, d };
}
