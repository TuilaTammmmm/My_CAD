/**
 * Client-side 2D image vectorizer & CAD Script converter.
 * - Filters out white background and thin/faint construction lines.
 * - Applies Zhang-Suen skeletonization (1px thinning) so thick lines & circles
 *   never produce double walls or zig-zags.
 * - Splits at junctions, fits clean circles, simplifies polylines, and snaps
 *   near-horizontal/near-vertical lines.
 */

function rdpSimplify(pts, eps) {
  if (pts.length <= 2) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const lenSq = dx * dx + dy * dy;

  let maxDist = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    let dist;
    if (lenSq < 1e-8) {
      dist = Math.hypot(pts[i].x - first.x, pts[i].y - first.y);
    } else {
      const t = ((pts[i].x - first.x) * dx + (pts[i].y - first.y) * dy) / lenSq;
      const px = first.x + t * dx;
      const py = first.y + t * dy;
      dist = Math.hypot(pts[i].x - px, pts[i].y - py);
    }
    if (dist > maxDist) {
      maxDist = dist;
      idx = i;
    }
  }

  if (maxDist > eps) {
    const left = rdpSimplify(pts.slice(0, idx + 1), eps);
    const right = rdpSimplify(pts.slice(idx), eps);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function fitCircleIfClosed(pts) {
  if (pts.length < 16) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) > 10) return null;

  let sx = 0, sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / pts.length;
  const cy = sy / pts.length;

  let rSum = 0;
  const dists = [];
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    dists.push(d);
    rSum += d;
  }
  const r = rSum / pts.length;
  if (r < 6) return null;

  let maxErr = 0;
  for (const d of dists) {
    const err = Math.abs(d - r);
    if (err > maxErr) maxErr = err;
  }
  if (maxErr / r > 0.14) return null;
  return { cx, cy, r };
}

/**
 * Zhang-Suen thinning to reduce thick strokes to clean 1px skeletons.
 */
function skeletonize(mask, w, h) {
  const img = new Uint8Array(mask);
  const toClear = [];
  let changed = true;
  let iter = 0;

  while (changed && iter < 24) {
    changed = false;
    iter++;

    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const idx = row + x;
          if (!img[idx]) continue;

          const p2 = img[idx - w];
          const p3 = img[idx - w + 1];
          const p4 = img[idx + 1];
          const p5 = img[idx + w + 1];
          const p6 = img[idx + w];
          const p7 = img[idx + w - 1];
          const p8 = img[idx - 1];
          const p9 = img[idx - w - 1];

          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;

          let A = 0;
          if (!p2 && p3) A++;
          if (!p3 && p4) A++;
          if (!p4 && p5) A++;
          if (!p5 && p6) A++;
          if (!p6 && p7) A++;
          if (!p7 && p8) A++;
          if (!p8 && p9) A++;
          if (!p9 && p2) A++;
          if (A !== 1) continue;

          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }

          toClear.push(idx);
        }
      }
      if (toClear.length > 0) {
        changed = true;
        for (let k = 0; k < toClear.length; k++) {
          img[toClear[k]] = 0;
        }
      }
    }
  }
  return img;
}

/**
 * Trace bold/colored strokes from an HTMLImageElement into 2D CAD elements.
 * @param {HTMLImageElement} img
 * @param {{ originU: number, originV: number, worldWidth: number, worldHeight: number, snapStep?: number }} rect
 * @returns {Array}
 */
export function traceImageTo2DElements(img, rect) {
  const maxDim = 760;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(16, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(16, Math.round((img.naturalHeight || img.height) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h).data;

  // 1. Detect dark or strongly colored pixels (ignoring white bg and pale thin projection lines)
  const rawMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = imgData[i * 4];
    const g = imgData[i * 4 + 1];
    const b = imgData[i * 4 + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = maxC - minC;
    if (luma < 150 || (sat > 60 && luma < 210)) {
      rawMask[i] = 1;
    }
  }

  // 2. Keep only bold strokes (filter out 1px thin construction/projection lines)
  const boldMask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (!rawMask[idx]) continue;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (rawMask[(y + dy) * w + (x + dx)]) count++;
        }
      }
      if (count >= 5) boldMask[idx] = 1;
    }
  }

  // 3. Thin bold strokes to crisp 1px skeleton
  const skel = skeletonize(boldMask, w, h);

  // 4. Trace 1px skeleton chains cleanly
  const visited = new Uint8Array(w * h);
  const dirs = [
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [-1, -1], [1, -1]
  ];
  const chains = [];

  const countNeighbors = (cx, cy) => {
    let c = 0;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && skel[ny * w + nx]) c++;
    }
    return c;
  };

  // Trace starting from endpoints (1 neighbor) first, then remaining closed loops
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const startIdx = y * w + x;
        if (!skel[startIdx] || visited[startIdx]) continue;
        if (pass === 0 && countNeighbors(x, y) !== 1) continue;

        const chain = [];
        let cx = x;
        let cy = y;
        let prevDx = 0;
        let prevDy = 0;

        while (true) {
          const idx = cy * w + cx;
          visited[idx] = 1;
          chain.push({ x: cx, y: cy });

          let best = null;
          let bestScore = -Infinity;
          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx <= 0 || nx >= w - 1 || ny <= 0 || ny >= h - 1) continue;
            const nIdx = ny * w + nx;
            if (!skel[nIdx] || visited[nIdx]) continue;
            // Prefer continuing in the same direction
            const align = prevDx * dx + prevDy * dy;
            const orthoBonus = (dx === 0 || dy === 0) ? 0.2 : 0;
            const score = align + orthoBonus;
            if (score > bestScore) {
              bestScore = score;
              best = { x: nx, y: ny, dx, dy };
            }
          }
          if (!best) break;
          prevDx = best.dx;
          prevDy = best.dy;
          cx = best.x;
          cy = best.y;
        }

        // Filter out tiny noise/text (e.g. "45°" label)
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of chain) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const span = Math.max(maxX - minX, maxY - minY);
        if (chain.length >= 12 && span >= 12) {
          chains.push(chain);
        }
      }
    }
  }

  const snapStep = rect.snapStep || 0;
  const toWorld = (px, py) => {
    let u = rect.originU + (px / w) * rect.worldWidth;
    let v = rect.originV + (1 - py / h) * rect.worldHeight;
    if (snapStep > 0) {
      u = Math.round(u / snapStep) * snapStep;
      v = Math.round(v / snapStep) * snapStep;
    }
    return { u: Number(u.toFixed(2)), v: Number(v.toFixed(2)) };
  };

  const elements = [];
  for (const chain of chains) {
    const circle = fitCircleIfClosed(chain);
    if (circle) {
      const cWorld = toWorld(circle.cx, circle.cy);
      const rWorld = Number(((circle.r / w) * rect.worldWidth).toFixed(2));
      if (rWorld > 0.15) {
        elements.push({
          type: 'circle',
          style: 'visible',
          cx: cWorld.u,
          cy: cWorld.v,
          r: rWorld
        });
      }
      continue;
    }

    const simplified = rdpSimplify(chain, 3.0);
    for (let i = 0; i < simplified.length - 1; i++) {
      let p1 = toWorld(simplified[i].x, simplified[i].y);
      let p2 = toWorld(simplified[i + 1].x, simplified[i + 1].y);

      // Snap near-horizontal or near-vertical lines cleanly
      const du = Math.abs(p2.u - p1.u);
      const dv = Math.abs(p2.v - p1.v);
      if (du > 0.2 && dv < du * 0.08) {
        const avgV = Number(((p1.v + p2.v) / 2).toFixed(2));
        p1 = { u: p1.u, v: avgV };
        p2 = { u: p2.u, v: avgV };
      } else if (dv > 0.2 && du < dv * 0.08) {
        const avgU = Number(((p1.u + p2.u) / 2).toFixed(2));
        p1 = { u: avgU, v: p1.v };
        p2 = { u: avgU, v: p2.v };
      }

      if (Math.hypot(p2.u - p1.u, p2.v - p1.v) > 0.2) {
        elements.push({
          type: 'line',
          style: 'visible',
          p1,
          p2
        });
      }
    }
  }

  return elements;
}

/**
 * Convert 2D elements (outer contour + circular holes) into a CAD Script.
 */
export function elementsToCadScript(elements, depth = 20) {
  const circles = elements.filter((e) => e.type === 'circle' && e.style !== 'hidden');
  const lines = elements.filter((e) => e.type === 'line' && e.style !== 'hidden');

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const l of lines) {
    minU = Math.min(minU, l.p1.u, l.p2.u);
    maxU = Math.max(maxU, l.p1.u, l.p2.u);
    minV = Math.min(minV, l.p1.v, l.p2.v);
    maxV = Math.max(maxV, l.p1.v, l.p2.v);
  }
  for (const c of circles) {
    minU = Math.min(minU, c.cx - c.r);
    maxU = Math.max(maxU, c.cx + c.r);
    minV = Math.min(minV, c.cy - c.r);
    maxV = Math.max(maxV, c.cy + c.r);
  }

  if (!Number.isFinite(minU)) {
    return `const khoi = hop(${depth}, ${depth}, ${depth});\nreturn khoi;`;
  }

  const w = Math.max(1, Number((maxU - minU).toFixed(2)));
  const h = Math.max(1, Number((maxV - minV).toFixed(2)));
  const cx = (minU + maxU) / 2;
  const cy = (minV + maxV) / 2;

  const scriptLines = [
    `// Tự động sinh từ bản vẽ 2D (${w} × ${h}, dày ${depth})`,
    `let khoi = hop(${w}, ${h}, ${depth});`
  ];

  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = Number((c.cx - cx).toFixed(2));
    const dy = Number((c.cy - cy).toFixed(2));
    const r = Number(c.r.toFixed(2));
    scriptLines.push(`const lo${i + 1} = tru(${r}, ${depth + 4}, 'z').dich(${dx}, ${dy}, 0);`);
    scriptLines.push(`khoi = khoi.cat(lo${i + 1});`);
  }

  scriptLines.push(`return khoi;`);
  return scriptLines.join('\n');
}
