import * as THREE from 'three';

export class GridOverlay {
  constructor(scene) {
    this.scene = scene;
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    // Mũi tên FRONT hiển thị độc lập (luôn hiện cả ở Chỉ Xem)
    this.arrowGroup = new THREE.Group();
    this.scene.add(this.arrowGroup);

    // Lưới sàn đáy (Floor grid)
    this.floorGrid = new THREE.GridHelper(40, 40, 0x0284c7, 0x334155);
    this.floorGrid.position.y = -0.01;
    this.scene.add(this.floorGrid);
  }

  setVisible(visible) {
    this.gridGroup.visible = visible;
    this.arrowGroup.visible = true;
  }

  setAllVisible(visible) {
    this.gridGroup.visible = visible;
    this.arrowGroup.visible = visible;
    this.floorGrid.visible = visible;
  }

  update(w, h, d, brush = null) {
    this.floorGrid.position.set(w / 2, -0.01, d / 2);

    // Xóa sạch các đường lưới phụ trên khối (Ẩn hoàn toàn lưới lơ lửng ngoài không khí theo đúng yêu cầu)
    while (this.gridGroup.children.length > 0) {
      const obj = this.gridGroup.children[0];
      this.gridGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    // Xóa mũi tên cũ
    while (this.arrowGroup.children.length > 0) {
      const obj = this.arrowGroup.children[0];
      this.arrowGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    // Mũi tên FRONT (Mặt trước) chuẩn kỹ thuật
    const arrowDir = new THREE.Vector3(0, 0, -1);
    const arrowOrigin = new THREE.Vector3(w / 2, 0.1, d + 3.2);
    const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 2.5, 0x38bdf8, 0.7, 0.4);
    this.arrowGroup.add(arrowHelper);
  }
}
