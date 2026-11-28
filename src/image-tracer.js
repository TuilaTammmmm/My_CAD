/**
 * Client-side 2D image vectorizer & CAD Script converter.
 * - Filters out white background and pale construction/projection lines.
 * - Applies Zhang-Suen skeletonization (1px thinning) for crisp visible lines & circles.
 * - Detects dashed hidden lines (`style: 'hidden'`) and merges collinear dashes.
 * - Draws directly onto exact image coordinates without grid-snap distortion.
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

function normAngle(a) {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
}

function fitCircle3Pts(pA, pB, pC) {
  const ax = pA.x, ay = pA.y;
  const bx = pB.x, by = pB.y;
  const cx = pC.x, cy = pC.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-4) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  if (!Number.isFinite(r) || r < 6 || r > 400) return null;
  return { cx: ux, cy: uy, r };
}

function fitArcFromPoints(pts) {
  if (pts.length < 12) return null;
  const pA = pts[0];
  const pMid = pts[Math.floor(pts.length / 2)];
  const pB = pts[pts.length - 1];
  const chord = Math.hypot(pB.x - pA.x, pB.y - pA.y);
  if (chord < 8) return null;

  const fit = fitCircle3Pts(pA, pMid, pB);
  if (!fit) return null;

  // Must curve meaningfully away from the chord
  let maxErr = 0;
  for (const p of pts) {
    const err = Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
    if (err > maxErr) maxErr = err;
  }
  if (maxErr > Math.max(2.6, fit.r * 0.065)) return null;

  // Check sweep angle >= 30 deg
  const a1 = Math.atan2(pA.y - fit.cy, pA.x - fit.cx);
  const aM = Math.atan2(pMid.y - fit.cy, pMid.x - fit.cx);
  const a2 = Math.atan2(pB.y - fit.cy, pB.x - fit.cx);
  const ccwSpan = normAngle(a2 - a1);
  const midInCcw = normAngle(aM - a1) < ccwSpan;
  const sweep = midInCcw ? ccwSpan : (Math.PI * 2 - ccwSpan);
  if (sweep < 0.52) return null;

  return { cx: fit.cx, cy: fit.cy, r: fit.r, pA, pMid, pB };
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

function traceSkeletonChains(skel, w, h, minLen, minSpan) {
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
            const align = prevDx * dx + prevDy * dy;
            const orthoBonus = (dx === 0 || dy === 0) ? 0.2 : 0;
            const score = align + orthoBonus;
            if (score > bestScore) {
              bestScore = score;
              best = { x: nx, y: ny, dx, dy };
            }
          }
          if (!best) {
            // Connect to adjacent visited junction pixel so T-junctions & corners don't leave a 1px gap
            for (const [dx, dy] of dirs) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx > 0 && nx < w - 1 && ny > 0 && ny < h - 1 && skel[ny * w + nx] && visited[ny * w + nx]) {
                if (chain.length > 2) {
                  const prev = chain[chain.length - 2];
                  if (prev.x !== nx || prev.y !== ny) {
                    chain.push({ x: nx, y: ny });
                  }
                }
                break;
              }
            }
            break;
          }
          prevDx = best.dx;
          prevDy = best.dy;
          cx = best.x;
          cy = best.y;
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of chain) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const span = Math.max(maxX - minX, maxY - minY);
        if (chain.length >= minLen && span >= minSpan) {
          chains.push(chain);
        }
      }
    }
  }
  return chains;
}

/**
 * Merge collinear dash segments into full hidden lines (`style: 'hidden'`).
 */
function mergeCollinearDashes(dashes) {
  const segs = dashes.map((d) => {
    const dx = d.p2.u - d.p1.u;
    const dy = d.p2.v - d.p1.v;
    const len = Math.hypot(dx, dy);
    return {
      p1: d.p1,
      p2: d.p2,
      len,
      ux: dx / len,
      uy: dy / len,
      count: 1,
      merged: false
    };
  });

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].merged) continue;
      const s1 = segs[i];
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[j].merged) continue;
        const s2 = segs[j];

        const dot = Math.abs(s1.ux * s2.ux + s1.uy * s2.uy);
        if (dot < 0.98) continue;

        const v1x = s2.p1.u - s1.p1.u;
        const v1y = s2.p1.v - s1.p1.v;
        const proj1 = v1x * s1.ux + v1y * s1.uy;
        const perp1 = Math.hypot(v1x - proj1 * s1.ux, v1y - proj1 * s1.uy);
        if (perp1 > 0.16) continue;

        const v2x = s2.p2.u - s1.p1.u;
        const v2y = s2.p2.v - s1.p1.v;
        const proj2 = v2x * s1.ux + v2y * s1.uy;
        const perp2 = Math.hypot(v2x - proj2 * s1.ux, v2y - proj2 * s1.uy);
        if (perp2 > 0.16) continue;

        const min2 = Math.min(proj1, proj2);
        const max2 = Math.max(proj1, proj2);
        const gap = Math.max(0, -max2, min2 - s1.len);
        if (gap <= 1.2) {
          const newMin = Math.min(0, min2);
          const newMax = Math.max(s1.len, max2);
          const baseU = s1.p1.u;
          const baseV = s1.p1.v;
          s1.p1 = {
            u: Number((baseU + s1.ux * newMin).toFixed(2)),
            v: Number((baseV + s1.uy * newMin).toFixed(2))
          };
          s1.p2 = {
            u: Number((baseU + s1.ux * newMax).toFixed(2)),
            v: Number((baseV + s1.uy * newMax).toFixed(2))
          };
          s1.len = newMax - newMin;
          s1.count += s2.count;
          s2.merged = true;
          changed = true;
          break;
        }
      }
    }
  }

  return segs
    .filter((s) => !s.merged && s.count >= 2 && s.len > 0.5)
    .map((s) => ({
      type: 'line',
      style: 'hidden',
      p1: s.p1,
      p2: s.p2
    }));
}

/**
 * Trace bold visible strokes + dashed hidden lines from an HTMLImageElement into 2D CAD elements.
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

  // 1. Classify visible strokes (dark or saturated) vs thin dark hidden dashes
  const rawMask = new Uint8Array(w * h);
  const darkNeutralMask = new Uint8Array(w * h);
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
    if (luma < 145 && !(b > r + 35 && b > g + 15)) {
      darkNeutralMask[i] = 1;
    }
  }

  // 2. Bold mask for visible lines
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

  // 3. Hidden-line mask: dark neutral pixels NOT near any bold visible stroke
  const hiddenMask = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = y * w + x;
      if (!darkNeutralMask[idx] || boldMask[idx]) continue;
      let nearBold = false;
      for (let dy = -2; dy <= 2 && !nearBold; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (boldMask[(y + dy) * w + (x + dx)]) {
            nearBold = true;
            break;
          }
        }
      }
      if (!nearBold) hiddenMask[idx] = 1;
    }
  }

  const toWorld = (px, py) => ({
    u: Number((rect.originU + (px / w) * rect.worldWidth).toFixed(2)),
    v: Number((rect.originV + (1 - py / h) * rect.worldHeight).toFixed(2))
  });

  const snapOrtho = (p1, p2) => {
    const du = Math.abs(p2.u - p1.u);
    const dv = Math.abs(p2.v - p1.v);
    if (du > 0.15 && dv < du * 0.08) {
      const avgV = Number(((p1.v + p2.v) / 2).toFixed(2));
      return [{ u: p1.u, v: avgV }, { u: p2.u, v: avgV }];
    }
    if (dv > 0.15 && du < dv * 0.08) {
      const avgU = Number(((p1.u + p2.u) / 2).toFixed(2));
      return [{ u: avgU, v: p1.v }, { u: avgU, v: p2.v }];
    }
    return [p1, p2];
  };

  // 4. Trace visible lines & circles
  const boldSkel = skeletonize(boldMask, w, h);
  const boldChains = traceSkeletonChains(boldSkel, w, h, 18, 18);

  const emitArcWorld = (arcFit) => {
    const cW = toWorld(arcFit.cx, arcFit.cy);
    const pAW = toWorld(arcFit.pA.x, arcFit.pA.y);
    const pMW = toWorld(arcFit.pMid.x, arcFit.pMid.y);
    const pBW = toWorld(arcFit.pB.x, arcFit.pB.y);
    const rW = Number(((arcFit.r / w) * rect.worldWidth).toFixed(2));
    if (rW <= 0.15) return;
    const a1 = Math.atan2(pAW.v - cW.v, pAW.u - cW.u);
    const aM = Math.atan2(pMW.v - cW.v, pMW.u - cW.u);
    const a2 = Math.atan2(pBW.v - cW.v, pBW.u - cW.u);
    const ccw = normAngle(aM - a1) < normAngle(a2 - a1);
    elements.push({
      type: 'arc',
      style: 'visible',
      cx: cW.u,
      cy: cW.v,
      r: rW,
      startAngle: ccw ? a1 : a2,
      endAngle: ccw ? a2 : a1
    });
  };

  const elements = [];
  for (const chain of boldChains) {
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

    const wholeArc = fitArcFromPoints(chain);
    if (wholeArc) {
      emitArcWorld(wholeArc);
      continue;
    }

    const simplified = rdpSimplify(chain, 2.0);
    // Map simplified vertices back to chain indices to detect curved sub-runs
    const simpIdx = simplified.map((sp) => chain.indexOf(sp));
    let i = 0;
    while (i < simplified.length - 1) {
      // Try to find a curved run of >= 4 simplified vertices (e.g. semicircle + straight transition)
      let arcEnd = -1;
      if (i + 3 < simplified.length) {
        for (let j = simplified.length - 1; j >= i + 3; j--) {
          const sub = chain.slice(simpIdx[i], simpIdx[j] + 1);
          const subArc = fitArcFromPoints(sub);
          if (subArc) {
            emitArcWorld(subArc);
            arcEnd = j;
            break;
          }
        }
      }
      if (arcEnd !== -1) {
        i = arcEnd;
        continue;
      }

      const [p1, p2] = snapOrtho(toWorld(simplified[i].x, simplified[i].y), toWorld(simplified[i + 1].x, simplified[i + 1].y));
      if (Math.hypot(p2.u - p1.u, p2.v - p1.v) > 0.25) {
        elements.push({ type: 'line', style: 'visible', p1, p2 });
      }
      i++;
    }
  }

  // 5. Trace dashed hidden lines and merge collinear dashes
  const hiddenSkel = skeletonize(hiddenMask, w, h);
  const dashChains = traceSkeletonChains(hiddenSkel, w, h, 5, 5);
  const rawDashes = [];
  for (const chain of dashChains) {
    if (chain.length > 35) continue; // ignore long non-dash shapes
    const [p1, p2] = snapOrtho(toWorld(chain[0].x, chain[0].y), toWorld(chain[chain.length - 1].x, chain[chain.length - 1].y));
    const len = Math.hypot(p2.u - p1.u, p2.v - p1.v);
    if (len >= 0.15 && len <= 1.6) {
      rawDashes.push({ p1, p2 });
    }
  }

  const hiddenLines = mergeCollinearDashes(rawDashes);
  elements.push(...hiddenLines);

  // 6. Weld nearby endpoints & snap T-junctions so all lines connect cleanly with 0 gap
  weldAndSnapLines(elements, 0.28);

  return elements;
}

function weldAndSnapLines(elements, tol = 0.28) {
  const lines = elements.filter((e) => e.type === 'line');
  if (lines.length === 0) return;

  // A. Cluster nearby endpoints (including arc start/end points) into exact shared vertices
  const endpoints = [];
  for (const l of lines) {
    endpoints.push(l.p1, l.p2);
  }
  for (const e of elements) {
    if (e.type === 'arc') {
      endpoints.push(
        { u: Number((e.cx + e.r * Math.cos(e.startAngle)).toFixed(2)), v: Number((e.cy + e.r * Math.sin(e.startAngle)).toFixed(2)), _readonly: true },
        { u: Number((e.cx + e.r * Math.cos(e.endAngle)).toFixed(2)), v: Number((e.cy + e.r * Math.sin(e.endAngle)).toFixed(2)), _readonly: true }
      );
    }
  }
  const used = new Uint8Array(endpoints.length);
  for (let i = 0; i < endpoints.length; i++) {
    if (used[i]) continue;
    const cluster = [endpoints[i]];
    used[i] = 1;
    for (let j = i + 1; j < endpoints.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(endpoints[j].u - endpoints[i].u, endpoints[j].v - endpoints[i].v) <= tol) {
        cluster.push(endpoints[j]);
        used[j] = 1;
      }
    }
    if (cluster.length > 1) {
      const anchor = cluster.find((p) => p._readonly);
      let avgU, avgV;
      if (anchor) {
        avgU = anchor.u;
        avgV = anchor.v;
      } else {
        let su = 0, sv = 0;
        for (const p of cluster) {
          su += p.u;
          sv += p.v;
        }
        avgU = Number((su / cluster.length).toFixed(2));
        avgV = Number((sv / cluster.length).toFixed(2));
      }
      for (const p of cluster) {
        if (!p._readonly) {
          p.u = avgU;
          p.v = avgV;
        }
      }
    }
  }

  // B. Snap remaining free endpoints onto nearby segments (T-junctions)
  for (const l of lines) {
    for (const pt of [l.p1, l.p2]) {
      let bestDist = tol;
      let bestProj = null;
      for (const other of lines) {
        if (other === l) continue;
        const dx = other.p2.u - other.p1.u;
        const dy = other.p2.v - other.p1.v;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((pt.u - other.p1.u) * dx + (pt.v - other.p1.v) * dy) / lenSq));
        const px = other.p1.u + t * dx;
        const py = other.p1.v + t * dy;
        const d = Math.hypot(pt.u - px, pt.v - py);
        if (d > 1e-4 && d < bestDist) {
          bestDist = d;
          bestProj = { u: Number(px.toFixed(2)), v: Number(py.toFixed(2)) };
        }
      }
      if (bestProj) {
        pt.u = bestProj.u;
        pt.v = bestProj.v;
      }
    }
  }
}

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
