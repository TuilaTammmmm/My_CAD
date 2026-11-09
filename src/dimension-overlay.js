import * as THREE from 'three';

/**
 * DimensionOverlay
 * Quản lý hiển thị số đo kích thước kỹ thuật (W, H, D) theo tiêu chuẩn bản vẽ CAD:
 * - Tự động cập nhật số đo và hướng gióng khi đổi góc nhìn kỹ thuật (Đứng, Cạnh, Bằng, Trục đo)
 * - Đường gióng kích thước (Extension lines) + Đường kích thước (Dimension lines) có mũi tên 2 đầu
 * - Vạch chia kích thước từng ô (Ruler ticks: 1 ô, 0.5 ô)
 * - Nhãn số đo sắc nét (Text sprite) hiển thị kích thước thực tế
 * - HUD badge nổi thông báo góc nhìn và kích thước hiện tại
 */
export class DimensionOverlay {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.renderOrder = 998;
    this.scene.add(this.group);

    this.enabled = true; // Mặc định bật số đo khi đổi góc nhìn
    this.currentView = 'iso'; // 'iso', 'front', 'right', 'back', 'left', 'top'
    this.bounds = { w: 6, h: 4, d: 4 };
    this.snapStep = 1.0;

    // Line material chuẩn kỹ thuật CAD
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    });

    this.extMat = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.65,
      depthTest: false
    });

    // Arrow material
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      depthTest: false
    });

    this.badgeElement = document.getElementById('view-dim-badge');
    this.badgeTitle = document.getElementById('view-badge-title');
    this.badgeDims = document.getElementById('view-badge-dims');
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.group.visible = enabled;
    if (this.badgeElement) {
      this.badgeElement.style.display = enabled ? 'flex' : 'none';
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  updateBounds(w, h, d, snapStep = 1.0) {
    this.bounds = { w, h, d };
    this.snapStep = snapStep;
    this.rebuild();
  }

  setView(viewName) {
    this.currentView = viewName;
    this.rebuild();
  }

  // Tạo sprite chữ sắc nét từ 2D Canvas
  createTextSprite(text, color = '#38bdf8', bgColor = 'rgba(15, 23, 42, 0.92)') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = 2;
    canvas.width = 240 * dpr;
    canvas.height = 70 * dpr;
    ctx.scale(dpr, dpr);

    const w = 240, h = 70;
    const boxW = 180, boxH = 46;
    const x = (w - boxW) / 2;
    const y = (h - boxH) / 2;

    // Nền viên thuốc
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 12);
    ctx.fill();
    ctx.stroke();

    // Chữ số đo
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1010;
    sprite.scale.set(1.6, 0.48, 1);
    return sprite;
  }

  // Vẽ mũi tên kỹ thuật CAD (tam giác nhọn hướng vào vạch gióng)
  createArrowHead(tipPos, dirVector, length = 0.35, width = 0.14) {
    const dir = dirVector.clone().normalize();
    const coneGeom = new THREE.ConeGeometry(width, length, 10);
    // Xoay nón theo hướng vector
    coneGeom.translate(0, -length / 2, 0);
    const cone = new THREE.Mesh(coneGeom, this.arrowMat);
    cone.position.copy(tipPos);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    cone.renderOrder = 1005;
    return cone;
  }

  // Tạo 1 đường gióng kích thước hoàn chỉnh với mũi tên 2 đầu, vạch thước và số đo
  createDimensionDimension(pStart, pEnd, offsetVec, labelText, totalUnits) {
    const dimGroup = new THREE.Group();

    // Điểm dời ra ngoài theo vạch gióng
    const dStart = pStart.clone().add(offsetVec);
    const dEnd = pEnd.clone().add(offsetVec);

    const extOverhang = offsetVec.clone().normalize().multiplyScalar(0.35);

    // 1. Hai đường gióng kích thước (Extension Lines)
    const extPts = [
      pStart.x, pStart.y, pStart.z,
      dStart.x + extOverhang.x, dStart.y + extOverhang.y, dStart.z + extOverhang.z,
      pEnd.x, pEnd.y, pEnd.z,
      dEnd.x + extOverhang.x, dEnd.y + extOverhang.y, dEnd.z + extOverhang.z
    ];
    const extGeom = new THREE.BufferGeometry();
    extGeom.setAttribute('position', new THREE.Float32BufferAttribute(extPts, 3));
    const extLines = new THREE.LineSegments(extGeom, this.extMat);
    extLines.renderOrder = 1004;
    dimGroup.add(extLines);

    // 2. Đường kích thước chính (Dimension Line)
    const mainPts = [
      dStart.x, dStart.y, dStart.z,
      dEnd.x, dEnd.y, dEnd.z
    ];
    const mainGeom = new THREE.BufferGeometry();
    mainGeom.setAttribute('position', new THREE.Float32BufferAttribute(mainPts, 3));
    const mainLine = new THREE.LineSegments(mainGeom, this.lineMat);
    mainLine.renderOrder = 1004;
    dimGroup.add(mainLine);

    // 3. Mũi tên 2 đầu (Arrows)
    const axisDir = new THREE.Vector3().subVectors(dEnd, dStart).normalize();
    const arrowStart = this.createArrowHead(dStart, axisDir, 0.38, 0.14);
    const arrowEnd = this.createArrowHead(dEnd, axisDir.clone().negate(), 0.38, 0.14);
    dimGroup.add(arrowStart);
    dimGroup.add(arrowEnd);

    // 4. Vạch chia thước (Tick marks) dọc theo đường kích thước cho từng ô
    const tickPts = [];
    const tickNormal = offsetVec.clone().normalize().multiplyScalar(0.18);
    const totalLen = pStart.distanceTo(pEnd);
    const unitStep = 1.0;
    const count = Math.round(totalUnits);

    for (let i = 1; i < count; i++) {
      const frac = i / count;
      const tPos = new THREE.Vector3().lerpVectors(dStart, dEnd, frac);
      tickPts.push(
        tPos.x - tickNormal.x, tPos.y - tickNormal.y, tPos.z - tickNormal.z,
        tPos.x + tickNormal.x, tPos.y + tickNormal.y, tPos.z + tickNormal.z
      );
    }

    if (tickPts.length > 0) {
      const tickGeom = new THREE.BufferGeometry();
      tickGeom.setAttribute('position', new THREE.Float32BufferAttribute(tickPts, 3));
      const tickLines = new THREE.LineSegments(tickGeom, this.lineMat);
      tickLines.renderOrder = 1004;
      dimGroup.add(tickLines);
    }

    // 5. Sprite chữ kích thước nằm giữa
    const midPos = new THREE.Vector3().lerpVectors(dStart, dEnd, 0.5);
    const sprite = this.createTextSprite(labelText);
    sprite.position.copy(midPos);
    dimGroup.add(sprite);

    return dimGroup;
  }

  // Tái tạo các đường kích thước theo góc nhìn hiện tại
  rebuild() {
    // Xóa đối tượng cũ
    while (this.group.children.length > 0) {
      const obj = this.group.children[0];
      this.group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    }

    if (!this.enabled) return;

    const { w, h, d } = this.bounds;
    const view = this.currentView;

    let titleText = 'GÓC CHIẾU KỸ THUẬT';
    let dimsText = '';

    const offsetDist = 1.0;

    if (view === 'front') {
      // HÌNH CHIẾU ĐỨNG: Chiều Rộng (W) ngang đáy, Chiều Cao (H) bên trái
      titleText = 'HÌNH CHIẾU ĐỨNG (FRONT)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Cao: ${h} ô`;

      // Kích thước Rộng (X: 0 -> W, tại Y = 0, Z = D) dời theo -Y
      const pW1 = new THREE.Vector3(0, 0, d);
      const pW2 = new THREE.Vector3(w, 0, d);
      const offW = new THREE.Vector3(0, -offsetDist, 0);
      this.group.add(this.createDimensionDimension(pW1, pW2, offW, `Rộng: ${w}`, w));

      // Kích thước Cao (Y: 0 -> H, tại X = 0, Z = D) dời theo -X
      const pH1 = new THREE.Vector3(0, 0, d);
      const pH2 = new THREE.Vector3(0, h, d);
      const offH = new THREE.Vector3(-offsetDist, 0, 0);
      this.group.add(this.createDimensionDimension(pH1, pH2, offH, `Cao: ${h}`, h));

    } else if (view === 'right') {
      // HÌNH CHIẾU CẠNH PHẢI: Chiều Sâu (D) ngang đáy, Chiều Cao (H) bên phải
      titleText = 'HÌNH CHIẾU CẠNH PHẢI (RIGHT)';
      dimsText = `↔ Sâu: ${d} ô  |  ↕ Cao: ${h} ô`;

      // Kích thước Sâu (Z: 0 -> D, tại Y = 0, X = W) dời theo -Y
      const pD1 = new THREE.Vector3(w, 0, 0);
      const pD2 = new THREE.Vector3(w, 0, d);
      const offD = new THREE.Vector3(0, -offsetDist, 0);
      this.group.add(this.createDimensionDimension(pD1, pD2, offD, `Sâu: ${d}`, d));

      // Kích thước Cao (Y: 0 -> H, tại Z = d, X = W) dời theo +Z
      const pH1 = new THREE.Vector3(w, 0, d);
      const pH2 = new THREE.Vector3(w, h, d);
      const offH = new THREE.Vector3(0, 0, offsetDist);
      this.group.add(this.createDimensionDimension(pH1, pH2, offH, `Cao: ${h}`, h));

    } else if (view === 'back') {
      // HÌNH CHIẾU SAU: Chiều Rộng (W), Chiều Cao (H)
      titleText = 'HÌNH CHIẾU SAU (BACK)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Cao: ${h} ô`;

      const pW1 = new THREE.Vector3(0, 0, 0);
      const pW2 = new THREE.Vector3(w, 0, 0);
      const offW = new THREE.Vector3(0, -offsetDist, 0);
      this.group.add(this.createDimensionDimension(pW1, pW2, offW, `Rộng: ${w}`, w));

      const pH1 = new THREE.Vector3(w, 0, 0);
      const pH2 = new THREE.Vector3(w, h, 0);
      const offH = new THREE.Vector3(offsetDist, 0, 0);
      this.group.add(this.createDimensionDimension(pH1, pH2, offH, `Cao: ${h}`, h));

    } else if (view === 'left') {
      // HÌNH CHIẾU CẠNH TRÁI: Chiều Sâu (D), Chiều Cao (H)
      titleText = 'HÌNH CHIẾU CẠNH TRÁI (LEFT)';
      dimsText = `↔ Sâu: ${d} ô  |  ↕ Cao: ${h} ô`;

      const pD1 = new THREE.Vector3(0, 0, 0);
      const pD2 = new THREE.Vector3(0, 0, d);
      const offD = new THREE.Vector3(0, -offsetDist, 0);
      this.group.add(this.createDimensionDimension(pD1, pD2, offD, `Sâu: ${d}`, d));

      const pH1 = new THREE.Vector3(0, 0, 0);
      const pH2 = new THREE.Vector3(0, h, 0);
      const offH = new THREE.Vector3(0, 0, -offsetDist);
      this.group.add(this.createDimensionDimension(pH1, pH2, offH, `Cao: ${h}`, h));

    } else if (view === 'top') {
      // HÌNH CHIẾU BẰNG: Chiều Rộng (W) ngang, Chiều Sâu (D) dọc
      titleText = 'HÌNH CHIẾU BẰNG (TOP)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Sâu: ${d} ô`;

      // Kích thước Rộng (X: 0 -> W, tại Z = D, Y = H) dời theo +Z
      const pW1 = new THREE.Vector3(0, h, d);
      const pW2 = new THREE.Vector3(w, h, d);
      const offW = new THREE.Vector3(0, 0, offsetDist);
      this.group.add(this.createDimensionDimension(pW1, pW2, offW, `Rộng: ${w}`, w));

      // Kích thước Sâu (Z: 0 -> D, tại X = 0, Y = H) dời theo -X
      const pD1 = new THREE.Vector3(0, h, 0);
      const pD2 = new THREE.Vector3(0, h, d);
      const offD = new THREE.Vector3(-offsetDist, 0, 0);
      this.group.add(this.createDimensionDimension(pD1, pD2, offD, `Sâu: ${d}`, d));

    } else {
      // PHỐI CẢNH TRỤC ĐO (ISO 3D): Hiển thị cả 3 chiều không gian W, H, D
      titleText = 'PHỐI CẢNH TRỤC ĐO (ISO 3D)';
      dimsText = `↔ Rộng: ${w}  |  ↕ Cao: ${h}  |  ↗ Sâu: ${d}`;

      // Kích thước Rộng (X: 0 -> W)
      const pW1 = new THREE.Vector3(0, 0, d);
      const pW2 = new THREE.Vector3(w, 0, d);
      const offW = new THREE.Vector3(0, -offsetDist, offsetDist * 0.4);
      this.group.add(this.createDimensionDimension(pW1, pW2, offW, `Rộng: ${w}`, w));

      // Kích thước Cao (Y: 0 -> H)
      const pH1 = new THREE.Vector3(0, 0, d);
      const pH2 = new THREE.Vector3(0, h, d);
      const offH = new THREE.Vector3(-offsetDist, 0, offsetDist * 0.4);
      this.group.add(this.createDimensionDimension(pH1, pH2, offH, `Cao: ${h}`, h));

      // Kích thước Sâu (Z: 0 -> D)
      const pD1 = new THREE.Vector3(w, 0, 0);
      const pD2 = new THREE.Vector3(w, 0, d);
      const offD = new THREE.Vector3(offsetDist, -offsetDist * 0.5, 0);
      this.group.add(this.createDimensionDimension(pD1, pD2, offD, `Sâu: ${d}`, d));
    }

    // Cập nhật HUD badge
    if (this.badgeElement) {
      this.badgeElement.style.display = this.enabled ? 'flex' : 'none';
      if (this.badgeTitle) this.badgeTitle.textContent = titleText;
      if (this.badgeDims) this.badgeDims.textContent = dimsText;
    }
  }
}
