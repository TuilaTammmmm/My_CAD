import * as THREE from 'three';

/**
 * DimensionOverlay
 * Quản lý hiển thị số đo kích thước kỹ thuật (W, H, D) theo tiêu chuẩn bản vẽ CAD:
 * - Tự động cập nhật số đo và hướng gióng khi đổi góc nhìn (Đứng, Cạnh, Bằng, Trục đo)
 * - Mũi tên kỹ thuật 2 đầu dạng nét CAD sắc nét (không dùng khối nón to che khuất)
 * - Đường gióng kích thước thanh mảnh, tinh tế, không chìm dưới sàn
 * - Nhãn số đo (Text sprite) hiển thị kích thước rõ ràng, gọn gàng
 * - HUD badge nổi thông báo góc nhìn và số đo
 */
export class DimensionOverlay {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.renderOrder = 1005;
    this.scene.add(this.group);

    this.enabled = true; // Mặc định bật số đo khi đổi góc nhìn
    this.currentView = 'iso'; // 'iso', 'front', 'right', 'back', 'left', 'top'
    this.bounds = { w: 6, h: 4, d: 4 };
    this.snapStep = 1.0;

    // Đường kích thước chính: Xanh cyan kỹ thuật
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      depthTest: false
    });

    // Đường gióng kích thước: Màu slate xám xanh mờ hơn
    this.extMat = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.75,
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

  // Tạo sprite chữ số đo sắc nét từ 2D Canvas
  createTextSprite(text, color = '#38bdf8', bgColor = 'rgba(15, 23, 42, 0.94)') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = 2;
    canvas.width = 220 * dpr;
    canvas.height = 64 * dpr;
    ctx.scale(dpr, dpr);

    const w = 220, h = 64;
    const boxW = 160, boxH = 40;
    const x = (w - boxW) / 2;
    const y = (h - boxH) / 2;

    // Nền viên thuốc bóng bẩy
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 10);
    ctx.fill();
    ctx.stroke();

    // Chữ số đo
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
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
    sprite.scale.set(1.2, 0.36, 1);
    return sprite;
  }

  // Tạo mũi tên 2 cánh chuẩn kỹ thuật CAD (dạng line sắc nét, không bị méo góc nhìn)
  addArrowLines(linePts, tipPos, lineDir, perpVec, arrowLen = 0.28, arrowWing = 0.09) {
    const dir = lineDir.clone().normalize();
    const perp = perpVec.clone().normalize();

    const back = tipPos.clone().addScaledVector(dir, -arrowLen);
    const wing1 = back.clone().addScaledVector(perp, arrowWing);
    const wing2 = back.clone().addScaledVector(perp, -arrowWing);

    linePts.push(
      tipPos.x, tipPos.y, tipPos.z, wing1.x, wing1.y, wing1.z,
      tipPos.x, tipPos.y, tipPos.z, wing2.x, wing2.y, wing2.z
    );
  }

  // Tạo đường kích thước hoàn chỉnh: 2 đường gióng + 1 đường kích thước + 2 mũi tên + nhãn chữ
  createDimension(pStart, pEnd, offsetVec, perpArrowVec, labelText) {
    const dimGroup = new THREE.Group();

    const dStart = pStart.clone().add(offsetVec);
    const dEnd = pEnd.clone().add(offsetVec);
    const extOverhang = offsetVec.clone().normalize().multiplyScalar(0.25);

    // 1. Hai đường gióng (Extension Lines)
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

    // 2. Đường kích thước chính + 2 Mũi tên CAD ở 2 đầu
    const mainPts = [
      dStart.x, dStart.y, dStart.z,
      dEnd.x, dEnd.y, dEnd.z
    ];

    const axisDir = new THREE.Vector3().subVectors(dEnd, dStart).normalize();
    // Mũi tên ở đầu dStart (hướng từ trong ra dStart)
    this.addArrowLines(mainPts, dStart, axisDir, perpArrowVec, 0.3, 0.1);
    // Mũi tên ở đầu dEnd (hướng từ trong ra dEnd)
    this.addArrowLines(mainPts, dEnd, axisDir.clone().negate(), perpArrowVec, 0.3, 0.1);

    const mainGeom = new THREE.BufferGeometry();
    mainGeom.setAttribute('position', new THREE.Float32BufferAttribute(mainPts, 3));
    const mainLine = new THREE.LineSegments(mainGeom, this.lineMat);
    mainLine.renderOrder = 1006;
    dimGroup.add(mainLine);

    // 3. Nhãn số đo sắc nét ở chính giữa
    const midPos = new THREE.Vector3().lerpVectors(dStart, dEnd, 0.5);
    const sprite = this.createTextSprite(labelText);
    sprite.position.copy(midPos);
    dimGroup.add(sprite);

    return dimGroup;
  }

  // Tái tạo các đường số đo theo góc nhìn
  rebuild() {
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
    const offset = 0.8;

    if (view === 'front') {
      // HÌNH CHIẾU ĐỨNG: Rộng (W) ngang đáy, Cao (H) bên trái
      titleText = 'HÌNH CHIẾU ĐỨNG (FRONT)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Cao: ${h} ô`;

      // Rộng: Dời theo -Y tại Z = D
      const pW1 = new THREE.Vector3(0, 0, d);
      const pW2 = new THREE.Vector3(w, 0, d);
      this.group.add(this.createDimension(pW1, pW2, new THREE.Vector3(0, -offset, 0), new THREE.Vector3(0, 1, 0), `Rộng: ${w}`));

      // Cao: Dời theo -X tại Z = D
      const pH1 = new THREE.Vector3(0, 0, d);
      const pH2 = new THREE.Vector3(0, h, d);
      this.group.add(this.createDimension(pH1, pH2, new THREE.Vector3(-offset, 0, 0), new THREE.Vector3(1, 0, 0), `Cao: ${h}`));

    } else if (view === 'right') {
      // HÌNH CHIẾU CẠNH PHẢI: Sâu (D) ngang đáy, Cao (H) bên phải
      titleText = 'HÌNH CHIẾU CẠNH PHẢI (RIGHT)';
      dimsText = `↔ Sâu: ${d} ô  |  ↕ Cao: ${h} ô`;

      // Sâu: Dời theo -Y tại X = W
      const pD1 = new THREE.Vector3(w, 0, 0);
      const pD2 = new THREE.Vector3(w, 0, d);
      this.group.add(this.createDimension(pD1, pD2, new THREE.Vector3(0, -offset, 0), new THREE.Vector3(0, 1, 0), `Sâu: ${d}`));

      // Cao: Dời theo +Z tại X = W
      const pH1 = new THREE.Vector3(w, 0, d);
      const pH2 = new THREE.Vector3(w, h, d);
      this.group.add(this.createDimension(pH1, pH2, new THREE.Vector3(0, 0, offset), new THREE.Vector3(0, 0, -1), `Cao: ${h}`));

    } else if (view === 'back') {
      // HÌNH CHIẾU SAU: Rộng (W), Cao (H)
      titleText = 'HÌNH CHIẾU SAU (BACK)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Cao: ${h} ô`;

      const pW1 = new THREE.Vector3(0, 0, 0);
      const pW2 = new THREE.Vector3(w, 0, 0);
      this.group.add(this.createDimension(pW1, pW2, new THREE.Vector3(0, -offset, 0), new THREE.Vector3(0, 1, 0), `Rộng: ${w}`));

      const pH1 = new THREE.Vector3(w, 0, 0);
      const pH2 = new THREE.Vector3(w, h, 0);
      this.group.add(this.createDimension(pH1, pH2, new THREE.Vector3(offset, 0, 0), new THREE.Vector3(-1, 0, 0), `Cao: ${h}`));

    } else if (view === 'left') {
      // HÌNH CHIẾU CẠNH TRÁI: Sâu (D), Cao (H)
      titleText = 'HÌNH CHIẾU CẠNH TRÁI (LEFT)';
      dimsText = `↔ Sâu: ${d} ô  |  ↕ Cao: ${h} ô`;

      const pD1 = new THREE.Vector3(0, 0, 0);
      const pD2 = new THREE.Vector3(0, 0, d);
      this.group.add(this.createDimension(pD1, pD2, new THREE.Vector3(0, -offset, 0), new THREE.Vector3(0, 1, 0), `Sâu: ${d}`));

      const pH1 = new THREE.Vector3(0, 0, 0);
      const pH2 = new THREE.Vector3(0, h, 0);
      this.group.add(this.createDimension(pH1, pH2, new THREE.Vector3(0, 0, -offset), new THREE.Vector3(0, 0, 1), `Cao: ${h}`));

    } else if (view === 'top') {
      // HÌNH CHIẾU BẰNG: Rộng (W) ngang, Sâu (D) dọc
      titleText = 'HÌNH CHIẾU BẰNG (TOP)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Sâu: ${d} ô`;

      // Rộng: Dời theo +Z tại Y = H
      const pW1 = new THREE.Vector3(0, h, d);
      const pW2 = new THREE.Vector3(w, h, d);
      this.group.add(this.createDimension(pW1, pW2, new THREE.Vector3(0, 0, offset), new THREE.Vector3(0, 0, -1), `Rộng: ${w}`));

      // Sâu: Dời theo -X tại Y = H
      const pD1 = new THREE.Vector3(0, h, 0);
      const pD2 = new THREE.Vector3(0, h, d);
      this.group.add(this.createDimension(pD1, pD2, new THREE.Vector3(-offset, 0, 0), new THREE.Vector3(1, 0, 0), `Sâu: ${d}`));

    } else {
      // PHỐI CẢNH TRỤC ĐO (ISO 3D): Hiển thị gọn gàng 3 trục khung bao, KHÔNG chìm dưới sàn
      titleText = 'PHỐI CẢNH TRỤC ĐO (ISO 3D)';
      dimsText = `↔ Rộng: ${w}  |  ↕ Cao: ${h}  |  ↗ Sâu: ${d}`;

      // Kích thước Rộng (X: 0 -> W): Nằm trên sàn Y = 0, dời ra phía trước +Z
      const pW1 = new THREE.Vector3(0, 0, d);
      const pW2 = new THREE.Vector3(w, 0, d);
      this.group.add(this.createDimension(pW1, pW2, new THREE.Vector3(0, 0, offset), new THREE.Vector3(0, 1, 0), `Rộng: ${w}`));

      // Kích thước Sâu (Z: 0 -> D): Nằm trên sàn Y = 0, dời sang bên phải +X
      const pD1 = new THREE.Vector3(w, 0, 0);
      const pD2 = new THREE.Vector3(w, 0, d);
      this.group.add(this.createDimension(pD1, pD2, new THREE.Vector3(offset, 0, 0), new THREE.Vector3(0, 1, 0), `Sâu: ${d}`));

      // Kích thước Cao (Y: 0 -> H): Dọc theo cạnh đứng góc trái, dời sang -X
      const pH1 = new THREE.Vector3(0, 0, d);
      const pH2 = new THREE.Vector3(0, h, d);
      this.group.add(this.createDimension(pH1, pH2, new THREE.Vector3(-offset, 0, 0), new THREE.Vector3(0, 0, 1), `Cao: ${h}`));
    }

    // Cập nhật HUD badge nổi
    if (this.badgeElement) {
      this.badgeElement.style.display = this.enabled ? 'flex' : 'none';
      if (this.badgeTitle) this.badgeTitle.textContent = titleText;
      if (this.badgeDims) this.badgeDims.textContent = dimsText;
    }
  }
}
