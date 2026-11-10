import * as THREE from 'three';

/**
 * ProjectionScreensOverlay (3 Màn Chiếu Kỹ Thuật 2D Trong Không Gian 3D)
 * Tạo 3 màn chiếu phẳng cách các mặt của khối vài ô (Front, Top, Side)
 * Hiển thị chính xác nét thấy (visible) và nét khuất (hidden) kèm lưới ô vuông và kích thước,
 * giúp người dùng dễ dàng quan sát và đối chiếu kích thước hình chiếu 2D ngay trong 3D.
 */
export class ProjectionScreensOverlay {
  constructor(scene, projectionEngine) {
    this.scene = scene;
    this.projectionEngine = projectionEngine;
    this.group = new THREE.Group();
    this.group.name = 'projection-screens-overlay';
    this.group.renderOrder = 1010;
    this.group.visible = false; // Mặc định tắt, người dùng có thể bật/tắt tự do
    this.scene.add(this.group);

    this.enabled = false;
    this.w = 6;
    this.h = 4;
    this.d = 4;
    this.currentBrush = null;
    this.offsetDist = 2.0; // Khoảng cách từ mặt khối ra màn chiếu (2 ô)
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  update(w, h, d, brush = null) {
    this.w = w;
    this.h = h;
    this.d = d;
    this.currentBrush = brush;
    this.rebuild();
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

    if (!this.currentBrush) return;

    const { w, h, d, offsetDist } = this;
    const proj = this.projectionEngine.generateProjections(this.currentBrush, { w, h, d });

    // 1. MÀN CHIẾU ĐỨNG (FRONT) - Đặt phía sau khối tại Z = -offsetDist
    this.buildScreenFront(w, h, -offsetDist, proj.front);

    // 2. MÀN CHIẾU BẰNG (TOP) - Đặt bên dưới đáy khối tại Y = -offsetDist
    this.buildScreenTop(w, d, -offsetDist, proj.top);

    // 3. MÀN CHIẾU CẠNH (SIDE / RIGHT) - Đặt bên phải khối tại X = w + offsetDist
    this.buildScreenSide(d, h, w + offsetDist, proj.side || proj.right);
  }

  // Tạo màn chiếu Đứng (Phẳng X-Y, tại Z = zPos)
  buildScreenFront(w, h, zPos, frontData) {
    const screenGroup = new THREE.Group();
    screenGroup.name = 'screen-front';

    // 1. Tấm nền kính mờ kỹ thuật
    const planeGeom = new THREE.PlaneGeometry(w, h);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x0b1329,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const panel = new THREE.Mesh(planeGeom, planeMat);
    panel.position.set(w / 2, h / 2, zPos);
    screenGroup.add(panel);

    // 2. Khung viền màn chiếu
    const borderPts = [
      0, 0, zPos, w, 0, zPos,
      w, 0, zPos, w, h, zPos,
      w, h, zPos, 0, h, zPos,
      0, h, zPos, 0, 0, zPos
    ];
    const borderGeom = new THREE.BufferGeometry();
    borderGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    const borderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });
    screenGroup.add(new THREE.LineSegments(borderGeom, borderMat));

    // 3. Lưới ô vuông 1x1 trên màn chiếu
    const gridPts = [];
    for (let x = 1; x < w; x++) {
      gridPts.push(x, 0, zPos, x, h, zPos);
    }
    for (let y = 1; y < h; y++) {
      gridPts.push(0, y, zPos, w, y, zPos);
    }
    if (gridPts.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.55 });
      screenGroup.add(new THREE.LineSegments(gridGeom, gridMat));
    }

    // 4. Nhãn tiêu đề màn chiếu
    const titleSprite = this.createTextSprite('🖼️ HÌNH CHIẾU ĐỨNG (FRONT)', '#38bdf8');
    titleSprite.position.set(w / 2, h + 0.45, zPos);
    screenGroup.add(titleSprite);

    // 5. Nét hình chiếu từ 3D (Visible & Hidden)
    if (frontData) {
      this.addProjectionLines(screenGroup, frontData, (u, v) => new THREE.Vector3(u, v, zPos + 0.02), 0x38bdf8);
    }

    // 6. Đường gióng kết nối từ góc khối tới màn chiếu
    const guidePts = [
      0, 0, 0, 0, 0, zPos,
      w, 0, 0, w, 0, zPos,
      w, h, 0, w, h, zPos,
      0, h, 0, 0, h, zPos
    ];
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute('position', new THREE.Float32BufferAttribute(guidePts, 3));
    const guideMat = new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.45 });
    const guideLines = new THREE.LineSegments(guideGeom, guideMat);
    guideLines.computeLineDistances();
    screenGroup.add(guideLines);

    this.group.add(screenGroup);
  }

  // Tạo màn chiếu Bằng (Phẳng X-Z, tại Y = yPos)
  buildScreenTop(w, d, yPos, topData) {
    const screenGroup = new THREE.Group();
    screenGroup.name = 'screen-top';

    // 1. Tấm nền kính mờ
    const planeGeom = new THREE.PlaneGeometry(w, d);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x06281e,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const panel = new THREE.Mesh(planeGeom, planeMat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(w / 2, yPos, d / 2);
    screenGroup.add(panel);

    // 2. Khung viền màn chiếu
    const borderPts = [
      0, yPos, 0, w, yPos, 0,
      w, yPos, 0, w, yPos, d,
      w, yPos, d, 0, yPos, d,
      0, yPos, d, 0, yPos, 0
    ];
    const borderGeom = new THREE.BufferGeometry();
    borderGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    const borderMat = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.9 });
    screenGroup.add(new THREE.LineSegments(borderGeom, borderMat));

    // 3. Lưới ô vuông 1x1
    const gridPts = [];
    for (let x = 1; x < w; x++) {
      gridPts.push(x, yPos, 0, x, yPos, d);
    }
    for (let z = 1; z < d; z++) {
      gridPts.push(0, yPos, z, w, yPos, z);
    }
    if (gridPts.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridMat = new THREE.LineBasicMaterial({ color: 0x1e3a34, transparent: true, opacity: 0.55 });
      screenGroup.add(new THREE.LineSegments(gridGeom, gridMat));
    }

    // 4. Nhãn tiêu đề màn chiếu
    const titleSprite = this.createTextSprite('🖼️ HÌNH CHIẾU BẰNG (TOP)', '#10b981');
    titleSprite.position.set(w / 2, yPos, -0.45);
    screenGroup.add(titleSprite);

    // 5. Nét hình chiếu Top (u = X, v = d - Z -> Z = d - v)
    if (topData) {
      this.addProjectionLines(screenGroup, topData, (u, v) => new THREE.Vector3(u, yPos + 0.02, d - v), 0x10b981);
    }

    // 6. Đường gióng
    const guidePts = [
      0, 0, 0, 0, yPos, 0,
      w, 0, 0, w, yPos, 0,
      w, 0, d, w, yPos, d,
      0, 0, d, 0, yPos, d
    ];
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute('position', new THREE.Float32BufferAttribute(guidePts, 3));
    const guideMat = new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.45 });
    const guideLines = new THREE.LineSegments(guideGeom, guideMat);
    guideLines.computeLineDistances();
    screenGroup.add(guideLines);

    this.group.add(screenGroup);
  }

  // Tạo màn chiếu Cạnh (Phẳng Z-Y, tại X = xPos)
  buildScreenSide(d, h, xPos, sideData) {
    const screenGroup = new THREE.Group();
    screenGroup.name = 'screen-side';

    // 1. Tấm nền kính mờ
    const planeGeom = new THREE.PlaneGeometry(d, h);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x2b1e06,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const panel = new THREE.Mesh(planeGeom, planeMat);
    panel.rotation.y = Math.PI / 2;
    panel.position.set(xPos, h / 2, d / 2);
    screenGroup.add(panel);

    // 2. Khung viền màn chiếu
    const borderPts = [
      xPos, 0, 0, xPos, 0, d,
      xPos, 0, d, xPos, h, d,
      xPos, h, d, xPos, h, 0,
      xPos, h, 0, xPos, 0, 0
    ];
    const borderGeom = new THREE.BufferGeometry();
    borderGeom.setAttribute('position', new THREE.Float32BufferAttribute(borderPts, 3));
    const borderMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9 });
    screenGroup.add(new THREE.LineSegments(borderGeom, borderMat));

    // 3. Lưới ô vuông 1x1
    const gridPts = [];
    for (let z = 1; z < d; z++) {
      gridPts.push(xPos, 0, z, xPos, h, z);
    }
    for (let y = 1; y < h; y++) {
      gridPts.push(xPos, y, 0, xPos, y, d);
    }
    if (gridPts.length > 0) {
      const gridGeom = new THREE.BufferGeometry();
      gridGeom.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridMat = new THREE.LineBasicMaterial({ color: 0x3d3019, transparent: true, opacity: 0.55 });
      screenGroup.add(new THREE.LineSegments(gridGeom, gridMat));
    }

    // 4. Nhãn tiêu đề màn chiếu
    const titleSprite = this.createTextSprite('🖼️ HÌNH CHIẾU CẠNH (RIGHT)', '#f59e0b');
    titleSprite.position.set(xPos, h + 0.45, d / 2);
    screenGroup.add(titleSprite);

    // 5. Nét hình chiếu Side (u = Z, v = Y)
    if (sideData) {
      this.addProjectionLines(screenGroup, sideData, (u, v) => new THREE.Vector3(xPos - 0.02, v, u), 0xf59e0b);
    }

    // 6. Đường gióng
    const guidePts = [
      this.w, 0, 0, xPos, 0, 0,
      this.w, 0, d, xPos, 0, d,
      this.w, h, d, xPos, h, d,
      this.w, h, 0, xPos, h, 0
    ];
    const guideGeom = new THREE.BufferGeometry();
    guideGeom.setAttribute('position', new THREE.Float32BufferAttribute(guidePts, 3));
    const guideMat = new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.45 });
    const guideLines = new THREE.LineSegments(guideGeom, guideMat);
    guideLines.computeLineDistances();
    screenGroup.add(guideLines);

    this.group.add(screenGroup);
  }

  // Vẽ các nét thấy và nét khuất lên màn chiếu
  addProjectionLines(group, viewData, map3DFn, visibleColorHex) {
    // 1. Nét thấy (Liền nét, đậm rõ)
    if (viewData.visible && viewData.visible.length > 0) {
      const visPts = [];
      for (const line of viewData.visible) {
        const p1 = map3DFn(line.p1.u, line.p1.v);
        const p2 = map3DFn(line.p2.u, line.p2.v);
        visPts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
      const visGeom = new THREE.BufferGeometry();
      visGeom.setAttribute('position', new THREE.Float32BufferAttribute(visPts, 3));
      const visMat = new THREE.LineBasicMaterial({
        color: visibleColorHex,
        linewidth: 2.5,
        transparent: true,
        opacity: 0.98,
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
      }
      const hidGeom = new THREE.BufferGeometry();
      hidGeom.setAttribute('position', new THREE.Float32BufferAttribute(hidPts, 3));
      const hidMat = new THREE.LineDashedMaterial({
        color: 0x94a3b8,
        dashSize: 0.18,
        gapSize: 0.12,
        transparent: true,
        opacity: 0.75,
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
    canvas.width = 400;
    canvas.height = 70;
    const ctx = canvas.getContext('2d');

    // Nền tag hiện đại
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(8, 8, 384, 54, 14);
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = colorHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 200, 35);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(1.9, 0.35, 1);
    return sprite;
  }
}
