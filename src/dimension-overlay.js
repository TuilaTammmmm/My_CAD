import * as THREE from 'three';

/**
 * DimensionOverlay
 * Quản lý hiển thị số đo kích thước kỹ thuật (W, H, D) theo tiêu chuẩn bản vẽ kỹ thuật CAD:
 * - Tự động cập nhật số đo và hướng gióng khi đổi góc nhìn (Đứng, Cạnh, Bằng, Trục đo)
 * - Mũi tên kỹ thuật 2 đầu dạng nét CAD sắc nét (không dùng khối nón to che khuất)
 * - Đường gióng kích thước thanh mảnh, tinh tế, không chìm dưới sàn
 * - Nhãn số đo (Text sprite) hiển thị kích thước rõ ràng: Rộng: W, Cao: H, Sâu: D
 * - Khung hiển thị và lề căn chỉnh tự động để số đo luôn nằm trọn vẹn trong màn hình
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
      depthTest: false,
      depthWrite: false
    });

    // Đường gióng kích thước: Màu xám xanh thanh mảnh
    this.extMat = new THREE.LineBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false
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
  createTextSprite(text, color = '#38bdf8', bgColor = 'rgba(15, 23, 42, 0.96)') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const dpr = 2;
    canvas.width = 240 * dpr;
    canvas.height = 72 * dpr;
    ctx.scale(dpr, dpr);

    const w = 240, h = 72;
    const boxW = 160, boxH = 42;
    const x = (w - boxW) / 2;
    const y = (h - boxH) / 2;

    // Nền viên thuốc bo góc phong cách CAD hiện đại
    ctx.fillStyle = bgColor;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 10);
    ctx.fill();
    ctx.stroke();

    // Chữ số đo
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1010;
    sprite.scale.set(1.4, 0.42, 1);
    return sprite;
  }

  // Vẽ 2 mũi tên CAD tại 2 đầu đoạn thẳng: tip1 hướng về ngoài, tip2 hướng về ngoài
  addCadArrows(linePts, p1, p2, perpVec, arrowLen = 0.28, arrowWing = 0.1) {
    const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
    const perp = perpVec.clone().normalize();

    // Mũi tên tại p1 (hướng ra ngoài về phía p1)
    const back1 = p1.clone().addScaledVector(dir, arrowLen);
    const wing1A = back1.clone().addScaledVector(perp, arrowWing);
    const wing1B = back1.clone().addScaledVector(perp, -arrowWing);
    linePts.push(
      p1.x, p1.y, p1.z, wing1A.x, wing1A.y, wing1A.z,
      p1.x, p1.y, p1.z, wing1B.x, wing1B.y, wing1B.z
    );

    // Mũi tên tại p2 (hướng ra ngoài về phía p2)
    const back2 = p2.clone().addScaledVector(dir, -arrowLen);
    const wing2A = back2.clone().addScaledVector(perp, arrowWing);
    const wing2B = back2.clone().addScaledVector(perp, -arrowWing);
    linePts.push(
      p2.x, p2.y, p2.z, wing2A.x, wing2A.y, wing2A.z,
      p2.x, p2.y, p2.z, wing2B.x, wing2B.y, wing2B.z
    );
  }

  // Tạo đường kích thước hoàn chỉnh gồm:
  // - 2 đường gióng (kéo từ điểm đo và nhô qua đường kích thước 0.25 ô)
  // - 1 đường kích thước chính
  // - 2 mũi tên kỹ thuật CAD
  // - 1 nhãn số đo (badge text)
  createDimension(pStart, pEnd, offsetVec, perpArrowVec, labelText) {
    const dimGroup = new THREE.Group();

    const dStart = pStart.clone().add(offsetVec);
    const dEnd = pEnd.clone().add(offsetVec);
    const extOverhang = offsetVec.clone().normalize().multiplyScalar(0.28);

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

    // 2. Đường kích thước chính + 2 Mũi tên CAD
    const mainPts = [
      dStart.x, dStart.y, dStart.z,
      dEnd.x, dEnd.y, dEnd.z
    ];
    this.addCadArrows(mainPts, dStart, dEnd, perpArrowVec, 0.3, 0.1);

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
    const offset = 1.15; // Khoảng cách gióng kích thước chuẩn CAD

    if (view === 'front') {
      // HÌNH CHIẾU ĐỨNG (FRONT): Rộng (W) ngang đáy, Cao (H) bên trái
      titleText = 'HÌNH CHIẾU ĐỨNG (FRONT)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Cao: ${h} ô`;
      const zPlane = d + 0.02;

      // Kích thước Rộng (X: 0 -> W, gióng xuống -Y)
      const pW1 = new THREE.Vector3(0, 0, zPlane);
      const pW2 = new THREE.Vector3(w, 0, zPlane);
      this.group.add(this.createDimension(
        pW1, pW2,
        new THREE.Vector3(0, -offset, 0),
        new THREE.Vector3(0, 1, 0),
        `Rộng: ${w}`
      ));

      // Kích thước Cao (Y: 0 -> H, gióng sang -X)
      const pH1 = new THREE.Vector3(0, 0, zPlane);
      const pH2 = new THREE.Vector3(0, h, zPlane);
      this.group.add(this.createDimension(
        pH1, pH2,
        new THREE.Vector3(-offset, 0, 0),
        new THREE.Vector3(1, 0, 0),
        `Cao: ${h}`
      ));

    } else if (view === 'top') {
      // HÌNH CHIẾU BẰNG (TOP): Rộng (W) ngang, Sâu (D) dọc
      // Trục nhìn từ +Y xuống: +X là ngang, +Z là hướng xuống dưới màn hình
      titleText = 'HÌNH CHIẾU BẰNG (TOP)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Sâu: ${d} ô`;
      const yPlane = h + 0.02;

      // Kích thước Rộng (X: 0 -> W, gióng xuống đáy màn hình +Z)
      const pW1 = new THREE.Vector3(0, yPlane, d);
      const pW2 = new THREE.Vector3(w, yPlane, d);
      this.group.add(this.createDimension(
        pW1, pW2,
        new THREE.Vector3(0, 0, offset),
        new THREE.Vector3(0, 0, -1),
        `Rộng: ${w}`
      ));

      // Kích thước Sâu (Z: d -> 0, gióng sang trái màn hình -X)
      const pD1 = new THREE.Vector3(0, yPlane, d);
      const pD2 = new THREE.Vector3(0, yPlane, 0);
      this.group.add(this.createDimension(
        pD1, pD2,
        new THREE.Vector3(-offset, 0, 0),
        new THREE.Vector3(1, 0, 0),
        `Sâu: ${d}`
      ));

    } else if (view === 'right') {
      // HÌNH CHIẾU CẠNH PHẢI (RIGHT): Sâu (D) ngang đáy, Cao (H) bên trái
      titleText = 'HÌNH CHIẾU CẠNH PHẢI (RIGHT)';
      dimsText = `↔ Sâu: ${d} ô  |  ↕ Cao: ${h} ô`;
      const xPlane = w + 0.02;

      // Kích thước Sâu (Z: d -> 0, gióng xuống đáy -Y)
      const pD1 = new THREE.Vector3(xPlane, 0, d);
      const pD2 = new THREE.Vector3(xPlane, 0, 0);
      this.group.add(this.createDimension(
        pD1, pD2,
        new THREE.Vector3(0, -offset, 0),
        new THREE.Vector3(0, 1, 0),
        `Sâu: ${d}`
      ));

      // Kích thước Cao (Y: 0 -> H, gióng sang bên cạnh +Z)
      const pH1 = new THREE.Vector3(xPlane, 0, d);
      const pH2 = new THREE.Vector3(xPlane, h, d);
      this.group.add(this.createDimension(
        pH1, pH2,
        new THREE.Vector3(0, 0, offset),
        new THREE.Vector3(0, 0, -1),
        `Cao: ${h}`
      ));

    } else if (view === 'back') {
      // HÌNH CHIẾU SAU (BACK): Rộng (W), Cao (H)
      titleText = 'HÌNH CHIẾU SAU (BACK)';
      dimsText = `↔ Rộng: ${w} ô  |  ↕ Cao: ${h} ô`;
      const zPlane = -0.02;

      const pW1 = new THREE.Vector3(w, 0, zPlane);
      const pW2 = new THREE.Vector3(0, 0, zPlane);
      this.group.add(this.createDimension(
        pW1, pW2,
        new THREE.Vector3(0, -offset, 0),
        new THREE.Vector3(0, 1, 0),
        `Rộng: ${w}`
      ));

      const pH1 = new THREE.Vector3(w, 0, zPlane);
      const pH2 = new THREE.Vector3(w, h, zPlane);
      this.group.add(this.createDimension(
        pH1, pH2,
        new THREE.Vector3(offset, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        `Cao: ${h}`
      ));

    } else if (view === 'left') {
      // HÌNH CHIẾU CẠNH TRÁI (LEFT): Sâu (D), Cao (H)
      titleText = 'HÌNH CHIẾU CẠNH TRÁI (LEFT)';
      dimsText = `↔ Sâu: ${d} ô  |  ↕ Cao: ${h} ô`;
      const xPlane = -0.02;

      const pD1 = new THREE.Vector3(xPlane, 0, 0);
      const pD2 = new THREE.Vector3(xPlane, 0, d);
      this.group.add(this.createDimension(
        pD1, pD2,
        new THREE.Vector3(0, -offset, 0),
        new THREE.Vector3(0, 1, 0),
        `Sâu: ${d}`
      ));

      const pH1 = new THREE.Vector3(xPlane, 0, 0);
      const pH2 = new THREE.Vector3(xPlane, h, 0);
      this.group.add(this.createDimension(
        pH1, pH2,
        new THREE.Vector3(0, 0, -offset),
        new THREE.Vector3(0, 0, 1),
        `Cao: ${h}`
      ));

    } else {
      // PHỐI CẢNH TRỤC ĐO (ISO 3D): Hiển thị gọn gàng 3 trục khung bao W, H, D
      titleText = 'PHỐI CẢNH TRỤC ĐO (ISO 3D)';
      dimsText = `↔ Rộng: ${w}  |  ↕ Cao: ${h}  |  ↗ Sâu: ${d}`;

      // Kích thước Rộng (X: 0 -> W): Trên mặt đất, gióng ra phía trước +Z
      const pW1 = new THREE.Vector3(0, 0, d);
      const pW2 = new THREE.Vector3(w, 0, d);
      this.group.add(this.createDimension(
        pW1, pW2,
        new THREE.Vector3(0, 0, offset),
        new THREE.Vector3(0, 1, 0),
        `Rộng: ${w}`
      ));

      // Kích thước Sâu (Z: 0 -> D): Trên mặt đất, gióng sang bên phải +X
      const pD1 = new THREE.Vector3(w, 0, 0);
      const pD2 = new THREE.Vector3(w, 0, d);
      this.group.add(this.createDimension(
        pD1, pD2,
        new THREE.Vector3(offset, 0, 0),
        new THREE.Vector3(0, 1, 0),
        `Sâu: ${d}`
      ));

      // Kích thước Cao (Y: 0 -> H): Dọc cạnh đứng góc trái, gióng sang -X
      const pH1 = new THREE.Vector3(0, 0, d);
      const pH2 = new THREE.Vector3(0, h, d);
      this.group.add(this.createDimension(
        pH1, pH2,
        new THREE.Vector3(-offset, 0, 0),
        new THREE.Vector3(0, 0, 1),
        `Cao: ${h}`
      ));
    }

    // Cập nhật HUD badge nổi
    if (this.badgeElement) {
      this.badgeElement.style.display = this.enabled ? 'flex' : 'none';
      if (this.badgeTitle) this.badgeTitle.textContent = titleText;
      if (this.badgeDims) this.badgeDims.textContent = dimsText;
    }
  }
}
