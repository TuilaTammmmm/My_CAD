import * as THREE from 'three';

export class GridOverlay {
  constructor(scene) {
    this.scene = scene;
    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    // Floor grid
    this.floorGrid = new THREE.GridHelper(40, 40, 0x0284c7, 0x334155);
    this.floorGrid.position.y = -0.01;
    this.scene.add(this.floorGrid);
  }

  setVisible(visible) {
    this.gridGroup.visible = visible;
  }

  update(w, h, d) {
    this.floorGrid.position.set(w / 2, -0.01, d / 2);

    // Clear old markers
    while (this.gridGroup.children.length > 0) {
      const obj = this.gridGroup.children[0];
      this.gridGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    // 1. Khung hộp giới hạn (Bounding box outline)
    const boxGeom = new THREE.BoxGeometry(w, h, d);
    boxGeom.translate(w / 2, h / 2, d / 2);
    const boxEdges = new THREE.EdgesGeometry(boxGeom);
    const boxLines = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 })
    );
    this.gridGroup.add(boxLines);

    // 2. Các đường lưới ô phụ (Sub-grid lines trên các mặt chính)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.22 });
    const points = [];

    // Lưới mặt đáy Y = 0
    for (let x = 0; x <= w; x++) {
      points.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, 0, d));
    }
    for (let z = 0; z <= d; z++) {
      points.push(new THREE.Vector3(0, 0, z), new THREE.Vector3(w, 0, z));
    }

    // Lưới mặt trước Z = d
    for (let x = 0; x <= w; x++) {
      points.push(new THREE.Vector3(x, 0, d), new THREE.Vector3(x, h, d));
    }
    for (let y = 0; y <= h; y++) {
      points.push(new THREE.Vector3(0, y, d), new THREE.Vector3(w, y, d));
    }

    // Lưới mặt bên X = w
    for (let z = 0; z <= d; z++) {
      points.push(new THREE.Vector3(w, 0, z), new THREE.Vector3(w, h, z));
    }
    for (let y = 0; y <= h; y++) {
      points.push(new THREE.Vector3(w, y, 0), new THREE.Vector3(w, y, d));
    }

    const gridGeom = new THREE.BufferGeometry().setFromPoints(points);
    const subGridLines = new THREE.LineSegments(gridGeom, lineMat);
    this.gridGroup.add(subGridLines);

    // 3. Mũi tên FRONT (Mặt trước) chỉ thẳng vào mặt trước Z=d
    const arrowDir = new THREE.Vector3(0, 0, -1);
    const arrowOrigin = new THREE.Vector3(w / 2, 0.1, d + 3.2);
    const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 2.5, 0x38bdf8, 0.7, 0.4);
    this.gridGroup.add(arrowHelper);
  }
}
