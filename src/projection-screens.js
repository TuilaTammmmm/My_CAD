import * as THREE from 'three';

/**
 * ProjectionScreensOverlay (3 Màn Chiếu Kỹ Thuật 2D Đậm Nét Trong Không Gian 3D)
 * - Màn Chiếu Đứng (Front): Đặt ở PHÍA TRƯỚC mặt trước (Z = D + offsetDist)
 * - Màn Chiếu Bằng (Top): Đặt ở TRÊN ĐỈNH mặt trên (Y = H + offsetDist)
 * - Màn Chiếu Cạnh (Right): Đặt ở BÊN PHẢI mặt phải (X = W + offsetDist)
 * Tấm nền đục đặc đậm màu kỹ thuật (không nhìn xuyên qua), hiện rõ lưới ô vuông 1x1 và nét chiếu.
 * Tích hợp đầy đủ các cạnh để công cụ đo đạc (Inspection Tool) có thể đo chiều dài cạnh và góc trực tiếp trên màn chiếu.
 */
export class ProjectionScreensOverlay {
  constructor(scene, projectionEngine) {
    this.scene = scene;
    this.projectionEngine = projectionEngine;
    this.group = new THREE.Group();
    this.group.name = 'projection-screens-overlay';
    this.group.renderOrder = 1010;
    this.group.visible = false;
    this.scene.add(this.group);

    this.enabled = false;
    this.w = 6;
    this.h = 4;
    this.d = 4;
    this.currentBrush = null;
    this.offsetDist = 2.0; // Khoảng cách từ mặt khối ra màn chiếu (2 ô)

    // Danh sách cạnh 3D trên màn chiếu để công cụ đo đạc có thể đo cạnh & góc
    this.screenEdges = [];
    // Danh sách tấm nền màn chiếu để kiểm tra chắn tia nhìn (chống chọn xuyên qua)
    this.screenPanels = [];
    this.onUpdate = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
    if (this.onUpdate) this.onUpdate();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setOffsetDist(dist) {
    const val = Math.max(2, Math.min(10, Number(dist) || 2));
    this.offsetDist = val;
    this.rebuild();
    if (this.onUpdate) this.onUpdate();
  }

  update(w, h, d, brush = null) {
    this.w = w;
    this.h = h;
    this.d = d;
    this.currentBrush = brush;
    this.rebuild();
    if (this.onUpdate) this.onUpdate();
  }

  rebuild() {
    // Xóa sạch nội dung cũ
    while (this.group.children.length > 0) {
      const obj = this.group.children[0];
      this.group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    }

    this.screenEdges = [];
    this.screenPanels = [];
    if (!this.currentBrush) return;

    const { w, h, d, offsetDist } = this;
    const proj = this.projectionEngine.generateProjections(this.currentBrush, { w, h, d });

    // 1. MÀN CHIẾU ĐỨNG (FRONT) - Đặt PHÍA TRƯỚC khối tại Z = d + offsetDist
    this.buildScreenFront(w, h, d, d + offsetDist, proj.front);

    // 2. MÀN CHIẾU BẰNG (TOP) - Đặt TRÊN ĐỈNH khối tại Y = h + offsetDist
    this.buildScreenTop(w, h, d, h + offsetDist, proj.top);

    // 3. MÀN CHIẾU CẠNH (SIDE / RIGHT) - Đặt BÊN PHẢI khối tại X = w + offsetDist
    this.buildScreenSide(w, h, d, w + offsetDist, proj.side || proj.right);
  }

  // =========================================================================
  // 1. MÀN CHIẾU ĐỨNG (FRONT) - Phẳng X-Y, đặt phía trước tại Z = zPos
  // =========================================================================
  buildScreenFront(w, h, d, zPos, frontData) {
    const screenGroup = new THREE.Group();
    screenGroup.name = 'screen-front';

    // 1. Tấm nền đục đặc kỹ thuật (màu xanh than đậm, không nhìn xuyên qua)
    const planeGeom = new THREE.PlaneGeometry(w, h);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x050814,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    const panel = new THREE.Mesh(planeGeom, planeMat);
    panel.position.set(w / 2, h / 2, zPos);
    panel.userData = { isScreenPanel: true, screenName: 'Front' };
    screenGroup.add(panel);
    this.screenPanels.push(panel);

    // 2. Khung viền màn chiếu đậm nét màu Cyan (#38bdf8)
    const borderPts = [
      0, 0, zPos, w, 0, zPos,
      w, 0, zPos, w, h, zPos,
      w, h, zPos, 0, h, zPos,
      0, h, zPos, 0, 0, zPos
    ];
    const borderGeom = new THREE.BufferGeometry();
    borderGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    const borderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2.5 });
    screenGroup.add(new THREE.LineSegments(borderGeom, borderMat));

    // 3. Lưới ô vuông 1x1 trên màn chiếu
    const gridPts = [];
    for (let x = 1; x < w; x++) {
      gridPts.push(x, 0, zPos + 0.01, x, h, zPos + 0.01);
    }
    for (let y = 1; y < h; y++) {
      gridPts.push(0, y, zPos + 0.01, w, y, zPos + 0.01);
    }
    if (gridPts.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridMat = new THREE.LineBasicMaterial({ color: 0x334155, linewidth: 1.2 });
      screenGroup.add(new THREE.LineSegments(gridGeom, gridMat));
    }

    // 4. Nhãn tiêu đề màn chiếu
    const titleSprite = this.createTextSprite(`🖼️ HÌNH CHIẾU ĐỨNG (${w}×${h})`, '#38bdf8');
    titleSprite.position.set(w / 2, h + 0.45, zPos);
    screenGroup.add(titleSprite);

    // 5. Nét hình chiếu từ 3D (u = X, v = Y)
    if (frontData) {
      this.addProjectionLines(screenGroup, frontData, (u, v) => new THREE.Vector3(u, v, zPos + 0.03), 0x38bdf8, 'Front');
    }

    // 6. Đường gióng từ 4 góc mặt trước khối ra 4 góc màn chiếu
    const guidePts = [
      0, 0, d, 0, 0, zPos,
      w, 0, d, w, 0, zPos,
      w, h, d, w, h, zPos,
      0, h, d, 0, h, zPos
    ];
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute('position', new THREE.Float32BufferAttribute(guidePts, 3));
    const guideMat = new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.5 });
    const guideLines = new THREE.LineSegments(guideGeom, guideMat);
    guideLines.computeLineDistances();
    screenGroup.add(guideLines);

    this.group.add(screenGroup);
  }

  // =========================================================================
  // 2. MÀN CHIẾU BẰNG (TOP) - Phẳng X-Z, đặt trên đỉnh khối tại Y = yPos
  // =========================================================================
  buildScreenTop(w, h, d, yPos, topData) {
    const screenGroup = new THREE.Group();
    screenGroup.name = 'screen-top';

    // 1. Tấm nền đục đặc kỹ thuật (màu xanh lục than đậm)
    const planeGeom = new THREE.PlaneGeometry(w, d);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x05140d,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    const panel = new THREE.Mesh(planeGeom, planeMat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(w / 2, yPos, d / 2);
    panel.userData = { isScreenPanel: true, screenName: 'Top' };
    screenGroup.add(panel);
    this.screenPanels.push(panel);

    // 2. Khung viền màn chiếu màu Emerald (#10b981)
    const borderPts = [
      0, yPos, 0, w, yPos, 0,
      w, yPos, 0, w, yPos, d,
      w, yPos, d, 0, yPos, d,
      0, yPos, d, 0, yPos, 0
    ];
    const borderGeom = new THREE.BufferGeometry();
    borderGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    const borderMat = new THREE.LineBasicMaterial({ color: 0x10b981, linewidth: 2.5 });
    screenGroup.add(new THREE.LineSegments(borderGeom, borderMat));

    // 3. Lưới ô vuông 1x1 trên màn chiếu
    const gridPts = [];
    for (let x = 1; x < w; x++) {
      gridPts.push(x, yPos + 0.01, 0, x, yPos + 0.01, d);
    }
    for (let z = 1; z < d; z++) {
      gridPts.push(0, yPos + 0.01, z, w, yPos + 0.01, z);
    }
    if (gridPts.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridMat = new THREE.LineBasicMaterial({ color: 0x1e3a34, linewidth: 1.2 });
      screenGroup.add(new THREE.LineSegments(gridGeom, gridMat));
    }

    // 4. Nhãn tiêu đề màn chiếu
    const titleSprite = this.createTextSprite(`🖼️ HÌNH CHIẾU BẰNG (${w}×${d})`, '#10b981');
    titleSprite.position.set(w / 2, yPos + 0.45, -0.45);
    screenGroup.add(titleSprite);

    // 5. Nét hình chiếu Top (u = X, v = d - Z -> Z = d - v)
    if (topData) {
      this.addProjectionLines(screenGroup, topData, (u, v) => new THREE.Vector3(u, yPos + 0.03, d - v), 0x10b981, 'Top');
    }

    // 6. Đường gióng từ 4 góc mặt nóc khối lên 4 góc màn chiếu
    const guidePts = [
      0, h, 0, 0, yPos, 0,
      w, h, 0, w, yPos, 0,
      w, h, d, w, yPos, d,
      0, h, d, 0, yPos, d
    ];
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute('position', new THREE.Float32BufferAttribute(guidePts, 3));
    const guideMat = new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.5 });
    const guideLines = new THREE.LineSegments(guideGeom, guideMat);
    guideLines.computeLineDistances();
    screenGroup.add(guideLines);

    this.group.add(screenGroup);
  }

  // =========================================================================
  // 3. MÀN CHIẾU CẠNH (RIGHT) - Phẳng Z-Y, đặt bên phải khối tại X = xPos
  // =========================================================================
  buildScreenSide(w, h, d, xPos, sideData) {
    const screenGroup = new THREE.Group();
    screenGroup.name = 'screen-side';

    // 1. Tấm nền đục đặc kỹ thuật (màu hổ phách than đậm)
    const planeGeom = new THREE.PlaneGeometry(d, h);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x140c05,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    const panel = new THREE.Mesh(planeGeom, planeMat);
    panel.rotation.y = Math.PI / 2;
    panel.position.set(xPos, h / 2, d / 2);
    panel.userData = { isScreenPanel: true, screenName: 'Side' };
    screenGroup.add(panel);
    this.screenPanels.push(panel);

    // 2. Khung viền màn chiếu màu Vàng Hổ Phách (#f59e0b)
    const borderPts = [
      xPos, 0, 0, xPos, 0, d,
      xPos, 0, d, xPos, h, d,
      xPos, h, d, xPos, h, 0,
      xPos, h, 0, xPos, 0, 0
    ];
    const borderGeom = new THREE.BufferGeometry();
    borderGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    const borderMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2.5 });
    screenGroup.add(new THREE.LineSegments(borderGeom, borderMat));

    // 3. Lưới ô vuông 1x1 trên màn chiếu
    const gridPts = [];
    for (let z = 1; z < d; z++) {
      gridPts.push(xPos + 0.01, 0, z, xPos + 0.01, h, z);
    }
    for (let y = 1; y < h; y++) {
      gridPts.push(xPos + 0.01, y, 0, xPos + 0.01, y, d);
    }
    if (gridPts.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridMat = new THREE.LineBasicMaterial({ color: 0x3d3019, linewidth: 1.2 });
      screenGroup.add(new THREE.LineSegments(gridGeom, gridMat));
    }

    // 4. Nhãn tiêu đề màn chiếu
    const titleSprite = this.createTextSprite(`🖼️ HÌNH CHIẾU CẠNH (${d}×${h})`, '#f59e0b');
    titleSprite.position.set(xPos, h + 0.45, d / 2);
    screenGroup.add(titleSprite);

    // 5. Nét hình chiếu Side/Right (u = d - Z -> Z = d - u, v = Y)
    if (sideData) {
      this.addProjectionLines(screenGroup, sideData, (u, v) => new THREE.Vector3(xPos + 0.03, v, d - u), 0xf59e0b, 'Right');
    }

    // 6. Đường gióng từ 4 góc mặt phải khối ra 4 góc màn chiếu
    const guidePts = [
      w, 0, 0, xPos, 0, 0,
      w, 0, d, xPos, 0, d,
      w, h, d, xPos, h, d,
      w, h, 0, xPos, h, 0
    ];
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute('position', new THREE.Float32BufferAttribute(guidePts, 3));
    const guideMat = new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.5 });
    const guideLines = new THREE.LineSegments(guideGeom, guideMat);
    guideLines.computeLineDistances();
    screenGroup.add(guideLines);

    this.group.add(screenGroup);
  }

  // Vẽ các nét thấy và nét khuất lên màn chiếu và lưu vào danh sách cạnh có thể đo đạc
  addProjectionLines(group, viewData, map3DFn, visibleColorHex, screenName) {
    // 1. Nét thấy (Liền nét, đậm rõ)
    if (viewData.visible && viewData.visible.length > 0) {
      const visPts = [];
      for (const line of viewData.visible) {
        const p1 = map3DFn(line.p1.u, line.p1.v);
        const p2 = map3DFn(line.p2.u, line.p2.v);
        visPts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);

        const len = p1.distanceTo(p2);
        if (len > 0.01) {
          this.screenEdges.push({
            id: `screen_${screenName}_${this.screenEdges.length}`,
            p1,
            p2,
            len: Number(len.toFixed(2)),
            mid: new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5),
            dir: new THREE.Vector3().subVectors(p2, p1).normalize(),
            isScreenEdge: true,
            screenName
          });
        }
      }

      const visGeom = new THREE.BufferGeometry();
      visGeom.setAttribute('position', new THREE.Float32BufferAttribute(visPts, 3));
      const visMat = new THREE.LineBasicMaterial({
        color: visibleColorHex,
        linewidth: 3.0,
        depthTest: true
      });
      group.add(new THREE.LineSegments(visGeom, visMat));
    }

    // 2. Nét khuất (Đứt nét chuẩn CAD)
    if (viewData.hidden && viewData.hidden.length > 0) {
      const hidPts = [];
      for (const line of viewData.hidden) {
        const p1 = map3DFn(line.p1.u, line.p1.v);
        const p2 = map3DFn(line.p2.u, line.p2.v);
        hidPts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);

        const len = p1.distanceTo(p2);
        if (len > 0.01) {
          this.screenEdges.push({
            id: `screen_hid_${screenName}_${this.screenEdges.length}`,
            p1,
            p2,
            len: Number(len.toFixed(2)),
            mid: new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5),
            dir: new THREE.Vector3().subVectors(p2, p1).normalize(),
            isScreenEdge: true,
            isHidden: true,
            screenName
          });
        }
      }

      const hidGeom = new THREE.BufferGeometry();
      hidGeom.setAttribute('position', new THREE.Float32BufferAttribute(hidPts, 3));
      const hidMat = new THREE.LineDashedMaterial({
        color: 0x94a3b8,
        dashSize: 0.22,
        gapSize: 0.15,
        depthTest: true
      });
      const dashed = new THREE.LineSegments(hidGeom, hidMat);
      dashed.computeLineDistances();
      group.add(dashed);
    }
  }

  // Tạo nhãn chữ Sprite 3D sắc nét
  createTextSprite(text, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 404, 54, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 210, 35);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2.0, 0.35, 1);
    return sprite;
  }

  // Lấy danh sách các tấm nền màn chiếu đang hiển thị (phục vụ chống bắt dính xuyên thấu)
  getScreenPanels() {
    return (this.enabled && this.group.visible) ? this.screenPanels : [];
  }
}
