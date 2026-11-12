import * as THREE from 'three';

export class InteractivePicker {
  constructor(scene, camera, renderer, controls, cadEngine, preview, callbacks) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.cad = cadEngine;
    this.preview = preview;
    this.callbacks = callbacks;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.currentBrush = null;
    this.bounds = { w: 6, h: 4, d: 4 };

    // Default mode: 'view' (Chỉ Xem)
    this.mode = 'view';

    // Bước bắt dính lưới: 1.0 (Nguyên ô) hoặc 0.5 (Cắt giữa ô)
    this.snapStep = 1.0;

    // Options
    this.slantCutAbove = true;
    this.slantPlane = 'XY';
    this.cornerDelta = { dx: 1, dy: -1, dz: -1 };

    // Tuỳ chỉnh độ sâu trực tiếp tại HUD
    this.customDepth = 4;
    this.isFullDepth = true;

    // Manual override cho đỉnh nhọn rãnh V (0, 1, 2 hoặc -1 là auto)
    this.vApexOverride = -1;

    // Index góc hộp cho vát góc 3 điểm
    this.cornerCandidateIndex = 0;

    // Tuỳ chỉnh Khoan lỗ tròn (Hole) & Bo tròn cạnh (Fillet 3D)
    this.holeRadius = 1.0;
    this.holeDepth = 2.0;
    this.holeThrough = true;
    this.holeCenter = null;
    this.holeNormal = null;

    this.filletRadius = 1.0;
    this.selectedFilletEdge = null;
    this.cachedSharpEdges = [];

    // Selected points in 3D: [ { x, y, z }, ... ]
    this.selectedPoints = [];

    this.pointerDownPos = { x: 0, y: 0 };
    this.isPointerDown = false;

    // 3D groups for markers
    this.pickerGroup = new THREE.Group();
    this.pickerGroup.renderOrder = 999;
    this.scene.add(this.pickerGroup);

    // Chấm nút lưới bề mặt (chỉ hiển thị quanh con trỏ chuột bằng 1 InstancedMesh duy nhất)
    this.MAX_LOCAL_NODES = 420;
    this.cachedFaces = [];
    this.cachedVertices = [];
    this.surfaceNodesList = [];
    this._lastHit = null;
    this.initLocalNodesMesh();

    // Hover snap marker
    this.initHoverMarker();

    // DOM HUD elements
    this.hudElement = document.getElementById('interactive-hud');
    this.tooltipElement = document.getElementById('picker-tooltip');

    this.bindEvents();
    this.updateCursor();
    this.updateHUD();
  }

  initLocalNodesMesh() {
    const geom = new THREE.SphereGeometry(1, 10, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9
    });
    this.localNodesMesh = new THREE.InstancedMesh(geom, mat, this.MAX_LOCAL_NODES);
    this.localNodesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.localNodesMesh.count = 0;
    this.localNodesMesh.visible = false;
    this.localNodesMesh.renderOrder = 999;
    this.localNodesMesh.frustumCulled = false;
    this.scene.add(this.localNodesMesh);
  }

  initHoverMarker() {
    const geom = new THREE.SphereGeometry(0.22, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92,
      depthTest: false
    });
    this.hoverMarker = new THREE.Mesh(geom, mat);
    this.hoverMarker.renderOrder = 1000;
    this.hoverMarker.visible = false;
    this.scene.add(this.hoverMarker);

    const ringGeom = new THREE.RingGeometry(0.30, 0.46, 28);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    });
    this.hoverRing = new THREE.Mesh(ringGeom, ringMat);
    this.hoverRing.renderOrder = 1001;
    this.hoverRing.visible = false;
    this.scene.add(this.hoverRing);
  }

  setProjectionScreens(screens) {
    this.projectionScreens = screens;
  }

  updateModel(brush, w, h, d) {
    this.currentBrush = brush;
    this.bounds = { w, h, d };
    this.customDepth = d;
    this.clearSelection();
    this.rebuildSurfaceGridNodes();
  }

  // Cache mặt phẳng, đỉnh và cạnh sắc nhẹ nhàng (0 tạo Mesh toàn khối -> 60fps với khối 100-300)
  rebuildSurfaceGridNodes() {
    this.cachedFaces = [];
    this.cachedVertices = [];
    this.cachedSharpEdges = [];
    this._lastHit = null;
    if (this.localNodesMesh) {
      this.localNodesMesh.count = 0;
      this.localNodesMesh.visible = false;
    }

    if (!this.currentBrush || !this.currentBrush.geometry) return;

    const nonIndexed = this.currentBrush.geometry.index ? this.currentBrush.geometry.toNonIndexed() : this.currentBrush.geometry;
    const pos = nonIndexed.attributes.position;
    const triCount = Math.floor(pos.count / 3);
    const triangles = [];
    const vertMap = new Map();

    const addVert = (v, n) => {
      const key = `${Math.round(v.x * 100)}_${Math.round(v.y * 100)}_${Math.round(v.z * 100)}`;
      const existing = vertMap.get(key);
      if (existing) {
        existing.normals.push(n);
      } else {
        const entry = { pos: v.clone(), normals: [n] };
        vertMap.set(key, entry);
        this.cachedVertices.push(entry);
      }
    };

    for (let i = 0; i < triCount; i++) {
      const p0 = new THREE.Vector3(pos.getX(i * 3), pos.getY(i * 3), pos.getZ(i * 3));
      const p1 = new THREE.Vector3(pos.getX(i * 3 + 1), pos.getY(i * 3 + 1), pos.getZ(i * 3 + 1));
      const p2 = new THREE.Vector3(pos.getX(i * 3 + 2), pos.getY(i * 3 + 2), pos.getZ(i * 3 + 2));
      const norm = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      const len = norm.length();
      if (len > 1e-6) {
        norm.normalize();
        const tri = { p0, p1, p2, norm };
        triangles.push(tri);
        addVert(p0, norm);
        addVert(p1, norm);
        addVert(p2, norm);
      }
    }

    for (const t of triangles) {
      const f = this.cachedFaces.find(
        item => item.norm.dot(t.norm) > 0.99 && Math.abs(item.norm.dot(t.p0.clone().sub(item.p0))) < 0.02
      );
      if (f) f.triangles.push(t);
      else this.cachedFaces.push({ norm: t.norm, p0: t.p0, triangles: [t] });
    }

    // Trích xuất cạnh sắc (giao bởi 2 mặt có góc gập > 25°) cho công cụ Bo Tròn Cạnh (Fillet 3D)
    const eKey = (v) => `${Math.round(v.x * 1000)}_${Math.round(v.y * 1000)}_${Math.round(v.z * 1000)}`;
    const edgeMap = new Map();
    for (const t of triangles) {
      const vs = [t.p0, t.p1, t.p2];
      for (let e = 0; e < 3; e++) {
        const a = vs[e];
        const b = vs[(e + 1) % 3];
        const ka = eKey(a);
        const kb = eKey(b);
        if (ka === kb) continue;
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        let entry = edgeMap.get(key);
        if (!entry) {
          entry = { p1: a.clone(), p2: b.clone(), normals: [] };
          edgeMap.set(key, entry);
        }
        entry.normals.push(t.norm);
      }
    }

    const rawSharp = [];
    for (const entry of edgeMap.values()) {
      if (entry.normals.length < 2) continue;
      const n1 = entry.normals[0];
      let n2 = null;
      for (let i = 1; i < entry.normals.length; i++) {
        if (n1.dot(entry.normals[i]) < 0.906) {
          n2 = entry.normals[i];
          break;
        }
      }
      if (n2) {
        rawSharp.push({ p1: entry.p1, p2: entry.p2, n1, n2 });
      }
    }

    // Gộp các đoạn cạnh sắc thẳng hàng có cùng cặp pháp tuyến (n1, n2)
    for (const seg of rawSharp) {
      const dir = new THREE.Vector3().subVectors(seg.p2, seg.p1).normalize();
      let merged = false;
      for (const existing of this.cachedSharpEdges) {
        const eDir = new THREE.Vector3().subVectors(existing.p2, existing.p1).normalize();
        if (Math.abs(dir.dot(eDir)) < 0.999) continue;
        const sameNormals =
          (existing.n1.dot(seg.n1) > 0.98 && existing.n2.dot(seg.n2) > 0.98) ||
          (existing.n1.dot(seg.n2) > 0.98 && existing.n2.dot(seg.n1) > 0.98);
        if (!sameNormals) continue;

        if (existing.p2.distanceTo(seg.p1) < 0.02) {
          existing.p2.copy(seg.p2);
          merged = true;
          break;
        } else if (existing.p2.distanceTo(seg.p2) < 0.02) {
          existing.p2.copy(seg.p1);
          merged = true;
          break;
        } else if (existing.p1.distanceTo(seg.p1) < 0.02) {
          existing.p1.copy(seg.p2);
          merged = true;
          break;
        } else if (existing.p1.distanceTo(seg.p2) < 0.02) {
          existing.p1.copy(seg.p1);
          merged = true;
          break;
        }
      }
      if (!merged) {
        this.cachedSharpEdges.push(seg);
      }
    }
  }

  isPointInTriangleBary(P, t) {
    const v2 = new THREE.Vector3().subVectors(P, t.p0);
    const dist = Math.abs(t.norm.dot(v2));
    if (dist > 0.03) return false;

    const v0 = new THREE.Vector3().subVectors(t.p2, t.p0);
    const v1 = new THREE.Vector3().subVectors(t.p1, t.p0);
    const dot00 = v0.dot(v0);
    const dot01 = v0.dot(v1);
    const dot02 = v0.dot(v2);
    const dot11 = v1.dot(v1);
    const dot12 = v1.dot(v2);
    const denom = dot00 * dot11 - dot01 * dot01;
    if (denom < 1e-5) return false;

    const invDenom = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return u >= -0.02 && v >= -0.02 && u + v <= 1.02;
  }

  updateVisibleGridNodes() {
    if (this.mode === 'view') {
      if (this.localNodesMesh) this.localNodesMesh.visible = false;
      return;
    }
    if (this._lastHit) {
      this.updateLocalNodesAroundCursor(this._lastHit.point, this._lastHit.normal);
    }
  }

  // Chỉ tính và vẽ các nút lưới nằm trong bán kính 10 bước quanh con trỏ chuột (1 draw call)
  updateLocalNodesAroundCursor(hitPoint, hitNormal) {
    if (!this.localNodesMesh || this.mode === 'view' || !hitPoint || !hitNormal) {
      if (this.localNodesMesh) this.localNodesMesh.visible = false;
      return;
    }

    const { w, h, d } = this.bounds;
    const step = this.snapStep;
    const radiusSteps = 10;
    const radiusWorld = radiusSteps * step;
    const radiusSq = radiusWorld * radiusWorld + 1e-4;

    // Tìm mặt phẳng tương ứng đang trỏ chuột để lọc các nút nằm trong diện tích mặt đó
    const matchingFaces = this.cachedFaces.filter(
      f => f.norm.dot(hitNormal) > 0.96 && Math.abs(f.norm.dot(hitPoint.clone().sub(f.p0))) < 0.08
    );

    const N = hitNormal;
    const absX = Math.abs(N.x), absY = Math.abs(N.y), absZ = Math.abs(N.z);
    const refP0 = matchingFaces.length > 0 ? matchingFaces[0].p0 : hitPoint;

    const scaleK = Math.max(1, Math.max(w, h, d) / 14);
    let rWhole = 0.085 * scaleK;
    let rHalf = 0.06 * scaleK;
    if (step <= 0.25) {
      rWhole = Math.min(0.065 * scaleK, step * 0.28);
      rHalf = Math.min(0.04 * scaleK, step * 0.18);
    }
    if (step <= 0.125) {
      rWhole = Math.min(0.05 * scaleK, step * 0.28);
      rHalf = Math.min(0.028 * scaleK, step * 0.18);
    }

    const isWhole = (v) => Math.abs(v - Math.round(v)) < 0.02;
    const snapAxis = (v) => Math.round(v / step) * step;

    const dummy = new THREE.Object3D();
    const colorWhole = new THREE.Color(0x38bdf8);
    const colorHalf = new THREE.Color(0x67e8f9);
    const pt = new THREE.Vector3();

    let count = 0;

    const tryEmit = (x, y, z) => {
      if (count >= this.MAX_LOCAL_NODES) return;
      pt.set(x, y, z);
      if (pt.distanceToSquared(hitPoint) > radiusSq) return;

      if (matchingFaces.length > 0) {
        let inside = false;
        for (const f of matchingFaces) {
          if (f.triangles.some(t => this.isPointInTriangleBary(pt, t))) {
            inside = true;
            break;
          }
        }
        if (!inside) return;
      }

      const whole = isWhole(x) && isWhole(y) && isWhole(z);
      dummy.position.copy(pt);
      dummy.scale.setScalar(whole ? rWhole : rHalf);
      dummy.updateMatrix();
      this.localNodesMesh.setMatrixAt(count, dummy.matrix);
      this.localNodesMesh.setColorAt(count, whole ? colorWhole : colorHalf);
      count++;
    };

    if (absZ >= absX && absZ >= absY && absZ > 1e-4) {
      const cx = snapAxis(hitPoint.x);
      const cy = snapAxis(hitPoint.y);
      const xMin = Math.max(0, cx - radiusWorld);
      const xMax = Math.min(w, cx + radiusWorld);
      const yMin = Math.max(0, cy - radiusWorld);
      const yMax = Math.min(h, cy + radiusWorld);
      for (let x = xMin; x <= xMax + 1e-4; x += step) {
        for (let y = yMin; y <= yMax + 1e-4; y += step) {
          const z = refP0.z - (N.x * (x - refP0.x) + N.y * (y - refP0.y)) / N.z;
          if (z >= -0.01 && z <= d + 0.01) {
            tryEmit(x, y, z);
          }
        }
      }
    } else if (absX >= absY && absX > 1e-4) {
      const cz = snapAxis(hitPoint.z);
      const cy = snapAxis(hitPoint.y);
      const zMin = Math.max(0, cz - radiusWorld);
      const zMax = Math.min(d, cz + radiusWorld);
      const yMin = Math.max(0, cy - radiusWorld);
      const yMax = Math.min(h, cy + radiusWorld);
      for (let z = zMin; z <= zMax + 1e-4; z += step) {
        for (let y = yMin; y <= yMax + 1e-4; y += step) {
          const x = refP0.x - (N.y * (y - refP0.y) + N.z * (z - refP0.z)) / N.x;
          if (x >= -0.01 && x <= w + 1e-4) {
            tryEmit(x, y, z);
          }
        }
      }
    } else if (absY > 1e-4) {
      const cx = snapAxis(hitPoint.x);
      const cz = snapAxis(hitPoint.z);
      const xMin = Math.max(0, cx - radiusWorld);
      const xMax = Math.min(w, cx + radiusWorld);
      const zMin = Math.max(0, cz - radiusWorld);
      const zMax = Math.min(d, cz + radiusWorld);
      for (let x = xMin; x <= xMax + 1e-4; x += step) {
        for (let z = zMin; z <= zMax + 1e-4; z += step) {
          const y = refP0.y - (N.x * (x - refP0.x) + N.z * (z - refP0.z)) / N.y;
          if (y >= -0.01 && y <= h + 1e-4) {
            tryEmit(x, y, z);
          }
        }
      }
    }

    this.localNodesMesh.count = count;
    this.localNodesMesh.instanceMatrix.needsUpdate = true;
    if (this.localNodesMesh.instanceColor) this.localNodesMesh.instanceColor.needsUpdate = true;
    this.localNodesMesh.visible = count > 0;
  }

  setMode(mode) {
    this.mode = mode;
    this.clearSelection();
    this.updateCursor();

    if (this.localNodesMesh) {
      this.localNodesMesh.visible = false;
    }

    if (this.mode === 'view') {
      this.hoverMarker.visible = false;
      this.hoverRing.visible = false;
      if (this.tooltipElement) this.tooltipElement.style.display = 'none';
    }

    this.updateHUD();
    if (this.callbacks.onModeChange) {
      this.callbacks.onModeChange(mode);
    }
  }

  updateCursor() {
    const dom = this.renderer.domElement;
    if (this.mode === 'view') {
      dom.style.cursor = 'grab';
    } else {
      dom.style.cursor = 'crosshair';
    }
  }

  clearSelection() {
    this.selectedPoints = [];
    this.holeCenter = null;
    this.holeNormal = null;
    this.selectedFilletEdge = null;
    this.vApexOverride = -1;
    this.cornerCandidateIndex = 0;
    while (this.pickerGroup.children.length > 0) {
      const obj = this.pickerGroup.children[0];
      this.pickerGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }
    this.preview.clear();
    this.updateHUD();
  }

  removeLastPoint() {
    if (this.selectedPoints.length > 0) {
      this.selectedPoints.pop();
      this.renderPointMarkers();
      if (this.mode === 'poly') {
        if (this.selectedPoints.length >= 3) {
          this.updatePreviewForPoly();
        } else {
          this.preview.clear();
        }
      } else if (this.mode === 'slant') {
        if (this.selectedPoints.length === 2) {
          this.updatePreviewForSlant();
        } else {
          this.preview.clear();
        }
      } else {
        this.preview.clear();
      }
      this.updateHUD();
      if (this.callbacks.onPointsChanged) {
        this.callbacks.onPointsChanged(this.mode, this.selectedPoints);
      }
    }
  }

  bindEvents() {
    const dom = this.renderer.domElement;
    const activePointers = new Set();

    const updateMouseFromEvent = (e) => {
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    dom.addEventListener('pointerdown', (e) => {
      activePointers.add(e.pointerId);
      if (activePointers.size > 1) {
        // Đa chạm (pinch zoom / pan 2 ngón) -> hủy click đơn điểm
        this.isPointerDown = false;
        return;
      }
      this.isPointerDown = true;
      this.pointerDownId = e.pointerId;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      updateMouseFromEvent(e);
      if (this.mode === 'view') {
        dom.style.cursor = 'grabbing';
      }
    });

    dom.addEventListener('pointermove', (e) => {
      updateMouseFromEvent(e);

      if (!this.isPointerDown && this.mode !== 'view') {
        this.handleHover(e);
      }
    });

    window.addEventListener('pointerup', (e) => {
      activePointers.delete(e.pointerId);
      if (!this.isPointerDown || e.pointerId !== this.pointerDownId) return;
      this.isPointerDown = false;
      this.updateCursor();

      if (this.mode === 'view') return;

      const maxMove = (e.pointerType === 'touch') ? 12 : 6;
      const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
      if (dist > maxMove) return;

      updateMouseFromEvent(e);
      this.handleClick(e);
    });

    window.addEventListener('pointercancel', (e) => {
      activePointers.delete(e.pointerId);
      if (e.pointerId === this.pointerDownId) {
        this.isPointerDown = false;
        this.updateCursor();
      }
    });

    // Khi người dùng xoay hoặc phóng to camera, cập nhật lại các nút lưới nhìn thấy
    if (this.controls) {
      this.controls.addEventListener('change', () => {
        this.updateVisibleGridNodes();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'Enter' || e.code === 'Space') {
        if (this.mode !== 'view') {
          e.preventDefault();
          this.executeCurrentCut();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.clearSelection();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (this.selectedPoints.length > 0 && (this.mode === 'poly' || this.mode === 'slant')) {
          e.preventDefault();
          this.removeLastPoint();
        }
      } else if (e.key === 'Tab' || e.key.toLowerCase() === 'f') {
        if (this.mode === 'slant') {
          e.preventDefault();
          this.toggleSlantDirection();
        } else if (this.mode === 'vgroove') {
          e.preventDefault();
          this.cycleVApex();
        } else if (this.mode === 'corner') {
          e.preventDefault();
          this.cycleCornerO();
        }
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.toggleSnapStep();
      } else if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (this.callbacks.onToggleGridSquares) this.callbacks.onToggleGridSquares();
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (this.callbacks.onToggleDim) this.callbacks.onToggleDim();
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (this.callbacks.onToggleScreens) this.callbacks.onToggleScreens();
      }
    });
  }

  // CHỈ BẮT DÍNH NÚT TRÊN MẶT ĐANG HƯỚNG VỀ PHÍA CAMERA (VÀ KHÔNG BỊ KHỐI CHE KHUẤT)
  findSnapPoint() {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    // 1. Bắn tia tới bề mặt khối trước để xác định khoảng cách mặt trước (frontHit)
    let frontHit = null;
    let hitPoint = null;
    let hitNormal = null;

    if (this.currentBrush) {
      const intersects = this.raycaster.intersectObject(this.currentBrush, false);
      for (const hit of intersects) {
        const norm = hit.face.normal.clone().transformDirection(this.currentBrush.matrixWorld).normalize();
        if (norm.dot(camDir) < -0.01) {
          frontHit = hit;
          hitPoint = hit.point;
          hitNormal = norm;
          break; // intersects đã sắp xếp từ gần đến xa, điểm đầu tiên là mặt trước ngoài cùng
        }
      }
    }

    // Chống bắt dính xuyên qua màn chiếu: Nếu chuột trỏ vào màn chiếu chắn trước khối
    if (this.projectionScreens && this.projectionScreens.getScreenPanels) {
      const sPanels = this.projectionScreens.getScreenPanels();
      if (sPanels.length > 0) {
        const sHits = this.raycaster.intersectObjects(sPanels, false);
        if (sHits.length > 0) {
          if (!frontHit || sHits[0].distance < frontHit.distance) {
            this._lastHit = null;
            return null; // Chuột trỏ trên màn chiếu, không chọn khối phía sau
          }
        }
      }
    }

    if (!hitPoint) {
      this._lastHit = null;
      return null;
    }

    this._lastHit = { point: hitPoint.clone(), normal: hitNormal.clone() };

    const scaleK = Math.max(1, Math.max(this.bounds.w, this.bounds.h, this.bounds.d) / 14);

    // 2. Bắt dính nhanh vào đỉnh hình học gần nhất (trên mặt đang trỏ)
    if (this.cachedVertices && this.cachedVertices.length > 0) {
      let closestVert = null;
      let minVDist = Math.max(0.22 * scaleK, this.snapStep * 0.48);
      for (const v of this.cachedVertices) {
        const d = hitPoint.distanceTo(v.pos);
        if (d < minVDist) {
          let facing = false;
          for (const n of v.normals) {
            if (n.dot(camDir) < -0.01) {
              facing = true;
              break;
            }
          }
          if (facing) {
            minVDist = d;
            closestVert = v.pos;
          }
        }
      }
      if (closestVert) {
        return closestVert.clone();
      }
    }

    // 3. Bắt lưới toán học trực tiếp trên mặt phẳng đang trỏ (hỗ trợ cả mặt nghiêng & trực giao)
    const snapVal = (v) => Number((Math.round(v / this.snapStep) * this.snapStep).toFixed(4));
    let sx = snapVal(hitPoint.x);
    let sy = snapVal(hitPoint.y);
    let sz = snapVal(hitPoint.z);

    // Nếu là mặt nghiêng/trụ, chiếu điểm snap trở lại mặt phẳng tiếp xúc
    const absX = Math.abs(hitNormal.x), absY = Math.abs(hitNormal.y), absZ = Math.abs(hitNormal.z);
    if (absZ > 0.98) {
      sz = (hitPoint.z > this.bounds.d / 2) ? this.bounds.d : 0;
      if (Math.abs(hitPoint.z - sz) > 0.05) sz = Number(hitPoint.z.toFixed(4));
    } else if (absX > 0.98) {
      sx = (hitPoint.x > this.bounds.w / 2) ? this.bounds.w : 0;
      if (Math.abs(hitPoint.x - sx) > 0.05) sx = Number(hitPoint.x.toFixed(4));
    } else if (absY > 0.98) {
      sy = (hitPoint.y > this.bounds.h / 2) ? this.bounds.h : 0;
      if (Math.abs(hitPoint.y - sy) > 0.05) sy = Number(hitPoint.y.toFixed(4));
    } else {
      // Mặt vát nghiêng hoặc trụ tròn: giải tọa độ trên mặt phẳng (hitPoint, hitNormal)
      if (absZ >= absX && absZ >= absY) {
        sz = hitPoint.z - (hitNormal.x * (sx - hitPoint.x) + hitNormal.y * (sy - hitPoint.y)) / hitNormal.z;
      } else if (absX >= absY) {
        sx = hitPoint.x - (hitNormal.y * (sy - hitPoint.y) + hitNormal.z * (sz - hitPoint.z)) / hitNormal.x;
      } else {
        sy = hitPoint.y - (hitNormal.x * (sx - hitPoint.x) + hitNormal.z * (sz - hitPoint.z)) / hitNormal.y;
      }
    }

    if (Math.abs(sx) < 0.02) sx = 0;
    if (Math.abs(sx - this.bounds.w) < 0.02) sx = this.bounds.w;
    if (Math.abs(sy) < 0.02) sy = 0;
    if (Math.abs(sy - this.bounds.h) < 0.02) sy = this.bounds.h;
    if (Math.abs(sz) < 0.02) sz = 0;
    if (Math.abs(sz - this.bounds.d) < 0.02) sz = this.bounds.d;

    sx = Math.max(0, Math.min(this.bounds.w, sx));
    sy = Math.max(0, Math.min(this.bounds.h, sy));
    sz = Math.max(0, Math.min(this.bounds.d, sz));

    const snapCandidate = new THREE.Vector3(sx, sy, sz);

    // Kiểm tra xem candidate có bị che khuất không
    const candNDC = snapCandidate.clone().project(this.camera);
    if (candNDC.z >= -1 && candNDC.z <= 1) {
      const occRay = new THREE.Raycaster();
      occRay.setFromCamera({ x: candNDC.x, y: candNDC.y }, this.camera);
      const occHits = occRay.intersectObject(this.currentBrush, false);
      if (occHits.length > 0) {
        const distToCandidate = occRay.ray.origin.distanceTo(snapCandidate);
        if (occHits[0].distance < distToCandidate - 0.15) {
          return hitPoint.clone();
        }
      }
    }

    return snapCandidate;
  }

  handleHover(e) {
    if (this.mode === 'view') return;

    const snap = this.findSnapPoint();
    if (!snap || !this._lastHit) {
      this.hoverMarker.visible = false;
      this.hoverRing.visible = false;
      if (this.localNodesMesh) this.localNodesMesh.visible = false;
      if (this.tooltipElement) this.tooltipElement.style.display = 'none';
      return;
    }

    this.updateLocalNodesAroundCursor(this._lastHit.point, this._lastHit.normal);

    const scaleK = Math.max(1, Math.max(this.bounds.w, this.bounds.h, this.bounds.d) / 14);
    this.hoverMarker.scale.setScalar(scaleK);
    this.hoverRing.scale.setScalar(scaleK);

    this.hoverMarker.position.copy(snap);
    this.hoverMarker.visible = true;

    this.hoverRing.position.copy(snap);
    this.hoverRing.quaternion.copy(this.camera.quaternion);
    this.hoverRing.visible = true;

    if (this.tooltipElement) {
      this.tooltipElement.style.display = 'block';
      this.tooltipElement.style.left = `${e.clientX + 14}px`;
      this.tooltipElement.style.top = `${e.clientY - 28}px`;
      const fmt = (n) => Number(n.toFixed(2));
      let html = `📍 <b>(${fmt(snap.x)}, ${fmt(snap.y)}, ${fmt(snap.z)})</b>`;
      if (this.selectedPoints.length > 0) {
        const p0 = this.selectedPoints[this.selectedPoints.length - 1];
        const dx = fmt(Math.abs(snap.x - p0.x));
        const dy = fmt(Math.abs(snap.y - p0.y));
        const dz = fmt(Math.abs(snap.z - p0.z));
        html += ` <span style="color:#38bdf8">| Δ(${dx}, ${dy}, ${dz})</span>`;
      }
      this.tooltipElement.innerHTML = html;
    }
  }

  handleClick(e) {
    if (this.mode === 'view') return;

    const snap = this.findSnapPoint();
    if (!snap) return;

    const pt = { x: snap.x, y: snap.y, z: snap.z };

    if (this.mode === 'corner') {
      this.cornerCandidateIndex = 0;
      if (this.selectedPoints.length >= 3) {
        this.selectedPoints = [pt];
      } else {
        const isDuplicate = this.selectedPoints.some(p => Math.hypot(p.x - pt.x, p.y - pt.y, p.z - pt.z) < 0.05);
        if (isDuplicate) return;
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 3) {
        this.updatePreviewForCorner();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'poly') {
      const isDuplicate = this.selectedPoints.some(p => Math.hypot(p.x - pt.x, p.y - pt.y, p.z - pt.z) < 0.05);
      if (isDuplicate) return;
      this.selectedPoints.push(pt);
      this.renderPointMarkers();
      if (this.selectedPoints.length >= 3) {
        this.updatePreviewForPoly();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'slant') {
      if (this.selectedPoints.length >= 3) {
        this.selectedPoints = [pt];
      } else {
        const isDuplicate = this.selectedPoints.some(p => Math.hypot(p.x - pt.x, p.y - pt.y, p.z - pt.z) < 0.05);
        if (isDuplicate) return;
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 2) {
        this.updatePreviewForSlant();
      } else if (this.selectedPoints.length === 3) {
        this.updatePreviewForPlane3Points();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'box') {
      if (this.selectedPoints.length >= 2) {
        this.selectedPoints = [pt];
      } else {
        if (this.selectedPoints.length === 1) {
          const p1 = this.selectedPoints[0];
          if (Math.hypot(p1.x - pt.x, p1.y - pt.y, p1.z - pt.z) < 0.05) return;
        }
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 2) {
        this.updatePreviewForBox();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'vgroove') {
      this.vApexOverride = -1;
      if (this.selectedPoints.length >= 3) {
        this.selectedPoints = [pt];
      } else {
        this.selectedPoints.push(pt);
      }
      this.renderPointMarkers();
      if (this.selectedPoints.length === 3) {
        this.updatePreviewForVGroove();
      } else {
        this.preview.clear();
      }

    } else if (this.mode === 'hole') {
      if (!this._lastHit) return;
      this.holeCenter = snap.clone();
      this.holeNormal = this._lastHit.normal.clone();
      this.selectedPoints = [{ x: snap.x, y: snap.y, z: snap.z }];
      this.renderPointMarkers();
      this.updatePreviewForHole();

    } else if (this.mode === 'fillet3d') {
      if (!this._lastHit) return;
      const edge = this.findNearestSharpEdge(this._lastHit.point);
      if (!edge) return;
      this.selectedFilletEdge = edge;
      this.selectedPoints = [
        { x: edge.p1.x, y: edge.p1.y, z: edge.p1.z },
        { x: edge.p2.x, y: edge.p2.y, z: edge.p2.z }
      ];
      this.renderPointMarkers();
      this.updatePreviewForFillet();
    }

    this.updateHUD();
    if (this.callbacks.onPointsChanged) {
      this.callbacks.onPointsChanged(this.mode, this.selectedPoints);
    }
  }

  findNearestSharpEdge(hitPoint) {
    if (!this.cachedSharpEdges || this.cachedSharpEdges.length === 0) return null;
    const scaleK = Math.max(1, Math.max(this.bounds.w, this.bounds.h, this.bounds.d) / 14);
    const maxDist = Math.max(0.75 * scaleK, 0.75);
    let best = null;
    let bestDist = maxDist;

    const line = new THREE.Line3();
    const closest = new THREE.Vector3();
    for (const edge of this.cachedSharpEdges) {
      line.set(edge.p1, edge.p2);
      line.closestPointToPoint(hitPoint, true, closest);
      const d = closest.distanceTo(hitPoint);
      if (d < bestDist) {
        bestDist = d;
        best = edge;
      }
    }
    return best;
  }

  updatePreviewForHole() {
    if (!this.holeCenter || !this.holeNormal || !this.currentBrush) {
      this.preview.clear();
      return;
    }
    const maxSpan = Math.max(this.bounds.w, this.bounds.h, this.bounds.d);
    this.preview.showHole(
      this.holeCenter,
      this.holeNormal,
      this.holeRadius,
      this.holeDepth,
      this.holeThrough,
      maxSpan,
      this.currentBrush,
      this.cad
    );
  }

  updatePreviewForFillet() {
    if (!this.selectedFilletEdge || !this.currentBrush) {
      this.preview.clear();
      return;
    }
    this.preview.showFilletEdge(
      this.selectedFilletEdge.p1,
      this.selectedFilletEdge.p2,
      this.selectedFilletEdge.n1,
      this.selectedFilletEdge.n2,
      this.filletRadius,
      this.currentBrush,
      this.cad
    );
  }

  // TỰ ĐỘNG PHÂN LOẠI CHÍNH XÁC APEX VÀ 2 BASE CỦA RÃNH V THEO GRID
  getVGroovePoints() {
    const pts = this.selectedPoints;
    if (pts.length < 3) return null;

    if (this.vApexOverride >= 0 && this.vApexOverride < 3) {
      const aIdx = this.vApexOverride;
      return {
        apex: pts[aIdx],
        base1: pts[(aIdx + 1) % 3],
        base2: pts[(aIdx + 2) % 3]
      };
    }

    // 1. Phân loại theo cạnh mép chuẩn: 2 chân rãnh luôn có chung toạ độ mép biên
    for (let i = 0; i < 3; i++) {
      const pA = pts[i];
      const pB = pts[(i + 1) % 3];
      const pC = pts[(i + 2) % 3];
      if (Math.abs(pB.y - pC.y) < 0.001 && Math.abs(pA.y - pB.y) > 0.001) return { apex: pA, base1: pB, base2: pC };
      if (Math.abs(pB.x - pC.x) < 0.001 && Math.abs(pA.x - pB.x) > 0.001) return { apex: pA, base1: pB, base2: pC };
      if (Math.abs(pB.z - pC.z) < 0.001 && Math.abs(pA.z - pB.z) > 0.001) return { apex: pA, base1: pB, base2: pC };
    }

    // 2. Phân loại theo tính chất đối xứng tam giác cân
    const d01 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y, pts[0].z - pts[1].z);
    const d12 = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y, pts[1].z - pts[2].z);
    const d20 = Math.hypot(pts[2].x - pts[0].x, pts[2].y - pts[0].y, pts[2].z - pts[0].z);
    if (Math.abs(d01 - d20) < 0.001) return { apex: pts[0], base1: pts[1], base2: pts[2] };
    if (Math.abs(d01 - d12) < 0.001) return { apex: pts[1], base1: pts[0], base2: pts[2] };
    if (Math.abs(d12 - d20) < 0.001) return { apex: pts[2], base1: pts[0], base2: pts[1] };

    return { apex: pts[0], base1: pts[1], base2: pts[2] };
  }

  cycleVApex() {
    if (this.selectedPoints.length < 3) return;
    const currentApex = this.getVGroovePoints().apex;
    const currentIdx = this.selectedPoints.indexOf(currentApex);
    this.vApexOverride = (currentIdx + 1) % 3;
    this.renderPointMarkers();
    this.updatePreviewForVGroove();
    this.updateHUD();
  }

  autoComputeCornerDeltas(corner) {
    const signX = (corner.x >= this.bounds.w / 2) ? -1 : 1;
    const signY = (corner.y >= this.bounds.h / 2) ? -1 : 1;
    const signZ = (corner.z >= this.bounds.d / 2) ? -1 : 1;

    const stepX = Math.min(this.snapStep, this.bounds.w);
    const stepY = Math.min(this.snapStep, this.bounds.h);
    const stepZ = Math.min(this.snapStep, this.bounds.d);

    this.cornerDelta = {
      dx: signX * stepX,
      dy: signY * stepY,
      dz: signZ * stepZ
    };
  }

  renderPointMarkers() {
    while (this.pickerGroup.children.length > 0) {
      const obj = this.pickerGroup.children[0];
      this.pickerGroup.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
    }

    const colors = [0x10b981, 0x0ea5e9, 0xf59e0b]; // 🟢 1: Lục bảo, 🔵 2: Lam điện, 🟡 3: Hổ phách
    const pts = this.selectedPoints;

    pts.forEach((pt, index) => {
      const color = (this.mode === 'corner') ? 0xf59e0b : colors[index % colors.length];

      // 1. Quả cầu lõi sáng to rõ
      const sphereGeom = new THREE.SphereGeometry(0.28, 18, 18);
      const sphereMat = new THREE.MeshBasicMaterial({ color: color, depthTest: false });
      const sphere = new THREE.Mesh(sphereGeom, sphereMat);
      sphere.position.set(pt.x, pt.y, pt.z);
      sphere.renderOrder = 1002;
      this.pickerGroup.add(sphere);

      // 2. Vòng hào quang ngoài wireframe lớn nổi bật
      const haloGeom = new THREE.SphereGeometry(0.46, 14, 14);
      const haloMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.45,
        wireframe: true,
        depthTest: false
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.position.set(pt.x, pt.y, pt.z);
      halo.renderOrder = 1003;
      this.pickerGroup.add(halo);

      // 3. Chấm tâm sáng trắng tạo điểm nhấn tương phản
      const sparkGeom = new THREE.SphereGeometry(0.1, 10, 10);
      const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
      const spark = new THREE.Mesh(sparkGeom, sparkMat);
      spark.position.set(pt.x, pt.y, pt.z);
      spark.renderOrder = 1004;
      this.pickerGroup.add(spark);
    });

    if (pts.length === 2 && this.mode === 'slant') {
      const p1 = new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z);
      const p2 = new THREE.Vector3(pts[1].x, pts[1].y, pts[1].z);
      const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        linewidth: 3,
        depthTest: false
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.renderOrder = 1004;
      this.pickerGroup.add(line);
    } else if ((pts.length >= 3 && this.mode === 'poly') || (pts.length === 3 && (this.mode === 'slant' || this.mode === 'corner'))) {
      const loopPts = pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
      loopPts.push(new THREE.Vector3(pts[0].x, pts[0].y, pts[0].z)); // Closed loop
      const lineGeom = new THREE.BufferGeometry().setFromPoints(loopPts);
      const lineMat = new THREE.LineBasicMaterial({
        color: (this.mode === 'corner') ? 0xf59e0b : 0x38bdf8,
        linewidth: 3,
        depthTest: false
      });
      const line = new THREE.Line(lineGeom, lineMat);
      line.renderOrder = 1004;
      this.pickerGroup.add(line);
    }
  }

  getCornerParams() {
    if (this.selectedPoints.length < 3) return null;
    const p1 = this.selectedPoints[0];
    const p2 = this.selectedPoints[1];
    const p3 = this.selectedPoints[2];

    const candidates = this.cad.findCandidateCornersFor3Points(p1, p2, p3);
    if (!candidates || candidates.length === 0) return null;

    const corner = candidates[this.cornerCandidateIndex % candidates.length];
    return { p1, p2, p3, corner, candidates };
  }

  updatePreviewForCorner() {
    const params = this.getCornerParams();
    if (!params) return;
    this.preview.showCorner3Points(params.p1, params.p2, params.p3, params.corner, this.currentBrush, this.cad);
  }

  cycleCornerO() {
    if (this.selectedPoints.length < 3) return;
    const params = this.getCornerParams();
    if (!params || params.candidates.length <= 1) return;
    this.cornerCandidateIndex = (this.cornerCandidateIndex + 1) % params.candidates.length;
    this.updatePreviewForCorner();
    this.updateHUD();
  }

  getSlantSliceParams() {
    if (this.selectedPoints.length < 2) return null;
    const p1 = this.selectedPoints[0];
    const p2 = this.selectedPoints[1];

    const slantParams = this.computeSlantParameters(p1, p2);
    let maxD = slantParams.depthMax;
    const depth = this.isFullDepth ? maxD : Math.min(this.customDepth, maxD);

    let dMin = 0, dMax = maxD;
    if (!this.isFullDepth) {
      let faceCoord = (slantParams.plane === 'XY') ? p1.z : (slantParams.plane === 'ZY') ? p1.x : p1.y;
      if (faceCoord >= maxD - 0.001) {
        dMin = maxD - depth;
        dMax = maxD;
      } else {
        dMin = 0;
        dMax = depth;
      }
    }

    return {
      plane: slantParams.plane,
      p1_2d: slantParams.p1_2d,
      p2_2d: slantParams.p2_2d,
      dMin,
      dMax,
      maxD
    };
  }

  updatePreviewForSlant() {
    const params = this.getSlantSliceParams();
    if (!params) return;

    this.slantPlane = params.plane;
    this.preview.showSlant(
      params.plane,
      params.p1_2d,
      params.p2_2d,
      params.dMin,
      params.dMax,
      this.slantCutAbove,
      this.bounds,
      this.currentBrush,
      this.cad
    );
  }


  updatePreviewForPlane3Points() {
    if (this.selectedPoints.length < 3) return;
    const [p1, p2, p3] = this.selectedPoints;
    this.preview.showPlane3Points(
      p1, p2, p3,
      this.slantCutAbove,
      this.bounds,
      this.currentBrush,
      this.cad,
      this.isFullDepth,
      this.customDepth
    );
  }

  updatePreviewForPoly() {
    if (this.selectedPoints.length < 3) return;
    this.preview.showMultiPointVolume(
      this.selectedPoints,
      this.customDepth,
      this.isFullDepth,
      this.bounds,
      this.currentBrush,
      this.cad
    );
  }

  getBoxSliceParams() {
    if (this.selectedPoints.length < 2) return null;
    const p1 = this.selectedPoints[0];
    const p2 = this.selectedPoints[1];

    let x1 = p1.x, x2 = p2.x;
    let y1 = p1.y, y2 = p2.y;
    let z1 = p1.z, z2 = p2.z;

    const d = this.isFullDepth ? this.bounds.d : this.customDepth;
    if (x1 === x2) x2 = (x1 === this.bounds.w) ? x1 - d : x1 + d;
    if (y1 === y2) y2 = (y1 === this.bounds.h) ? y1 - d : y1 + d;
    if (z1 === z2) z2 = (z1 === this.bounds.d) ? z1 - d : z1 + d;

    return { x1, x2, y1, y2, z1, z2 };
  }

  updatePreviewForBox() {
    const params = this.getBoxSliceParams();
    if (!params) return;
    this.preview.showBox(params.x1, params.x2, params.y1, params.y2, params.z1, params.z2, this.currentBrush, this.cad);
  }

  getVGrooveSliceParams() {
    const vPts = this.getVGroovePoints();
    if (!vPts) return null;

    const { apex, base1, base2 } = vPts;

    let plane = 'XY';
    let maxD = this.bounds.d;
    let a2d = { u: apex.x, v: apex.y };
    let b1_2d = { u: base1.x, v: base1.y };
    let b2_2d = { u: base2.x, v: base2.y };
    let faceCoord = apex.z;

    if (Math.abs(apex.x - base1.x) < 0.001 && Math.abs(apex.x - base2.x) < 0.001) {
      plane = 'ZY';
      maxD = this.bounds.w;
      a2d = { u: apex.z, v: apex.y };
      b1_2d = { u: base1.z, v: base1.y };
      b2_2d = { u: base2.z, v: base2.y };
      faceCoord = apex.x;
    } else if (Math.abs(apex.y - base1.y) < 0.001 && Math.abs(apex.y - base2.y) < 0.001) {
      plane = 'XZ';
      maxD = this.bounds.h;
      a2d = { u: apex.x, v: apex.z };
      b1_2d = { u: base1.x, v: base1.z };
      b2_2d = { u: base2.x, v: base2.z };
      faceCoord = apex.y;
    }

    const depth = this.isFullDepth ? maxD : Math.min(this.customDepth, maxD);
    let dMin = 0, dMax = maxD;
    if (!this.isFullDepth) {
      if (faceCoord >= maxD - 0.001) {
        // Cắt từ mặt ngoài bên phải/trên/trước vào trong
        dMin = maxD - depth;
        dMax = maxD;
      } else {
        // Cắt từ mặt bên trái/dưới/sau vào trong
        dMin = 0;
        dMax = depth;
      }
    }

    return { plane, a2d, b1_2d, b2_2d, dMin, dMax, maxD, apex, base1, base2 };
  }

  updatePreviewForVGroove() {
    const params = this.getVGrooveSliceParams();
    if (!params) return;
    this.preview.showVGroove(params.plane, params.a2d, params.b1_2d, params.b2_2d, params.dMin, params.dMax, this.currentBrush, this.cad);
  }

  computeSlantParameters(p1, p2) {
    const dx = Math.abs(p1.x - p2.x);
    const dy = Math.abs(p1.y - p2.y);
    const dz = Math.abs(p1.z - p2.z);

    let plane = 'XY';
    let p1_2d, p2_2d, depthMin, depthMax;

    if (dz < 0.001) {
      plane = 'XY';
      p1_2d = { u: p1.x, v: p1.y };
      p2_2d = { u: p2.x, v: p2.y };
      depthMin = 0;
      depthMax = this.bounds.d;
    } else if (dx < 0.001) {
      plane = 'ZY';
      p1_2d = { u: p1.z, v: p1.y };
      p2_2d = { u: p2.z, v: p2.y };
      depthMin = 0;
      depthMax = this.bounds.w;
    } else if (dy < 0.001) {
      plane = 'XZ';
      p1_2d = { u: p1.x, v: p1.z };
      p2_2d = { u: p2.x, v: p2.z };
      depthMin = 0;
      depthMax = this.bounds.h;
    } else {
      if (dx >= dz) {
        plane = 'XY';
        p1_2d = { u: p1.x, v: p1.y };
        p2_2d = { u: p2.x, v: p2.y };
        depthMin = 0;
        depthMax = this.bounds.d;
      } else {
        plane = 'ZY';
        p1_2d = { u: p1.z, v: p1.y };
        p2_2d = { u: p2.z, v: p2.y };
        depthMin = 0;
        depthMax = this.bounds.w;
      }
    }

    return { plane, p1_2d, p2_2d, depthMin, depthMax };
  }

  toggleSlantDirection() {
    this.slantCutAbove = !this.slantCutAbove;
    if (this.selectedPoints.length === 3) {
      this.updatePreviewForPlane3Points();
    } else {
      this.updatePreviewForSlant();
    }
    this.updateHUD();
  }

  setSnapStep(step) {
    const num = parseFloat(step) || 1.0;
    this.snapStep = num;
    this.rebuildSurfaceGridNodes();
    this.updateHUD();
    if (this.callbacks.onSnapStepChange) {
      this.callbacks.onSnapStepChange(this.snapStep);
    }
    return this.snapStep;
  }

  toggleSnapStep() {
    const STEPS = [1.0, 0.5, 0.25, 0.125];
    let idx = STEPS.findIndex(s => Math.abs(s - this.snapStep) < 0.001);
    if (idx === -1) idx = 0;
    const nextStep = STEPS[(idx + 1) % STEPS.length];
    return this.setSnapStep(nextStep);
  }

  changeDepth(delta) {
    this.isFullDepth = false;
    let maxVal = Math.max(this.bounds.w, this.bounds.h, this.bounds.d);
    if (this.mode === 'slant') {
      const sp = this.getSlantSliceParams();
      if (sp) maxVal = sp.maxD;
    } else if (this.mode === 'vgroove') {
      const vp = this.getVGrooveSliceParams();
      if (vp) maxVal = vp.maxD;
    }
    const step = this.snapStep;
    this.customDepth = Math.max(step, Math.min(maxVal, Math.round((this.customDepth + delta * step) * 10) / 10));
    if (this.mode === 'vgroove') this.updatePreviewForVGroove();
    else if (this.mode === 'slant') {
      if (this.selectedPoints.length === 3) this.updatePreviewForPlane3Points();
      else this.updatePreviewForSlant();
    }
    else if (this.mode === 'box') this.updatePreviewForBox();
    else if (this.mode === 'poly') this.updatePreviewForPoly();
    this.updateHUD();
  }

  setFullDepth() {
    this.isFullDepth = true;
    let maxVal = Math.max(this.bounds.w, this.bounds.h, this.bounds.d);
    if (this.mode === 'slant') {
      const sp = this.getSlantSliceParams();
      if (sp) maxVal = sp.maxD;
    } else if (this.mode === 'vgroove') {
      const vp = this.getVGrooveSliceParams();
      if (vp) maxVal = vp.maxD;
    }
    this.customDepth = maxVal;
    if (this.mode === 'vgroove') this.updatePreviewForVGroove();
    else if (this.mode === 'slant') {
      if (this.selectedPoints.length === 3) this.updatePreviewForPlane3Points();
      else this.updatePreviewForSlant();
    }
    else if (this.mode === 'box') this.updatePreviewForBox();
    else if (this.mode === 'poly') this.updatePreviewForPoly();
    this.updateHUD();
  }

  adjustCornerDelta(axis, change) {
    if (!this.cornerDelta) return;
    const current = Math.abs(this.cornerDelta[axis]);
    const maxVal = (axis === 'dx') ? this.bounds.w : (axis === 'dy') ? this.bounds.h : this.bounds.d;
    const step = this.snapStep;
    const newVal = Math.max(step, Math.min(maxVal, Math.round((current + change * step) * 10) / 10));
    const sign = Math.sign(this.cornerDelta[axis]) || 1;
    this.cornerDelta[axis] = sign * newVal;
    this.updatePreviewForCorner();
    this.updateHUD();
  }

  executeCurrentCut() {
    if (!this.currentBrush) return;

    try {
      let newBrush = null;

      if (this.mode === 'corner') {
        const params = this.getCornerParams();
        if (!params) return;
        newBrush = this.cad.cutCorner3Points(
          this.currentBrush,
          params.p1,
          params.p2,
          params.p3,
          params.corner
        );

      } else if (this.mode === 'poly') {
        newBrush = this.cad.cutMultiPointVolume(
          this.currentBrush,
          this.selectedPoints,
          this.customDepth,
          this.isFullDepth
        );

      } else if (this.mode === 'slant') {
        if (this.selectedPoints.length === 3) {
          const [p1, p2, p3] = this.selectedPoints;
          if (this.cad.isCoplanarOnFace && this.cad.isCoplanarOnFace(p1, p2, p3)) {
            newBrush = this.cad.cutMultiPointVolume(
              this.currentBrush,
              this.selectedPoints,
              this.customDepth,
              this.isFullDepth
            );
          } else {
            newBrush = this.cad.cutPlane3Points(
              this.currentBrush,
              p1, p2, p3,
              this.slantCutAbove,
              this.isFullDepth
            );
          }
        } else if (this.selectedPoints.length === 2) {
          const params = this.getSlantSliceParams();
          if (!params) return;
          newBrush = this.cad.cutSlant(
            this.currentBrush,
            params.plane,
            params.p1_2d,
            params.p2_2d,
            params.dMin,
            params.dMax,
            this.slantCutAbove
          );
        }

      } else if (this.mode === 'box') {
        const params = this.getBoxSliceParams();
        if (!params) return;
        newBrush = this.cad.cutBox(
          this.currentBrush,
          params.x1, params.x2,
          params.y1, params.y2,
          params.z1, params.z2
        );

      } else if (this.mode === 'vgroove') {
        const params = this.getVGrooveSliceParams();
        if (!params) return;
        newBrush = this.cad.cutVGroove(
          this.currentBrush,
          params.plane,
          params.a2d,
          params.b1_2d,
          params.b2_2d,
          params.dMin,
          params.dMax
        );

      } else if (this.mode === 'hole') {
        if (!this.holeCenter || !this.holeNormal) return;
        const maxSpan = Math.max(this.bounds.w, this.bounds.h, this.bounds.d);
        newBrush = this.cad.cutHole(
          this.currentBrush,
          this.holeCenter,
          this.holeNormal,
          this.holeRadius,
          this.holeDepth,
          this.holeThrough,
          maxSpan
        );

      } else if (this.mode === 'fillet3d') {
        if (!this.selectedFilletEdge) return;
        newBrush = this.cad.cutFilletEdge(
          this.currentBrush,
          this.selectedFilletEdge.p1,
          this.selectedFilletEdge.p2,
          this.selectedFilletEdge.n1,
          this.selectedFilletEdge.n2,
          this.filletRadius,
          20
        );
      }

      if (newBrush && this.callbacks.onCutExecute) {
        this.clearSelection();
        this.callbacks.onCutExecute(newBrush);
      }
    } catch (err) {
      console.error('Lỗi khi thực hiện cắt:', err);
      alert('Không thể thực hiện đường cắt với các điểm đã chọn! Hãy thử chọn lại.');
    }
  }

  // CẬP NHẬT THANH HUD VỚI ĐIỀU KHIỂN ĐỘ SÂU TRỰC TIẾP TẠI CHỖ
  updateHUD() {
    if (!this.hudElement) return;

    if (this.mode === 'view') {
      this.hudElement.innerHTML = `
        <div class="hud-step">
          <span class="hud-badge done">👁️ Chỉ Xem</span>
          <span>Click cạnh hoặc góc để đo kích thước & góc 3D.</span>
          <button class="hud-btn-toggle" id="hud-toggle-grid" title="Bật/Tắt lưới ô vuông hộp ban đầu (Phím tắt: G)">🔲 Ô Vuông</button>
          <button class="hud-btn-toggle" id="hud-toggle-dim" title="Bật/Tắt khung số đo tổng thể (Phím tắt: D)">📏 Khung Số Đo</button>
          <button class="hud-btn-toggle" id="hud-toggle-screens" title="Bật/Tắt 3 Màn Chiếu Kỹ Thuật 2D cách khối vài ô (Phím tắt: P)">📺 Màn Chiếu 2D</button>
          <button class="hud-btn-toggle" id="hud-toggle-inspect" title="Mở / Thu gọn bảng đo đạc bên phải">🔍 Bảng Đo</button>
          <button class="hud-btn-toggle" id="hud-clear-measures" style="color: #f87171; border-color: rgba(248, 113, 113, 0.4);" title="Xóa toàn bộ các số đo cạnh & góc đã lưu (Phím tắt: Delete)">🗑️ Xóa Số Đo</button>
        </div>
      `;
      const btnToggleGrid = document.getElementById('hud-toggle-grid');
      if (btnToggleGrid) btnToggleGrid.addEventListener('click', () => {
        if (this.callbacks.onToggleGridSquares) this.callbacks.onToggleGridSquares();
      });
      const btnToggleDim = document.getElementById('hud-toggle-dim');
      if (btnToggleDim) btnToggleDim.addEventListener('click', () => {
        if (this.callbacks.onToggleDim) this.callbacks.onToggleDim();
      });
      const btnToggleScreens = document.getElementById('hud-toggle-screens');
      if (btnToggleScreens) btnToggleScreens.addEventListener('click', () => {
        if (this.callbacks.onToggleScreens) this.callbacks.onToggleScreens();
      });
      const btnToggleInspect = document.getElementById('hud-toggle-inspect');
      if (btnToggleInspect) btnToggleInspect.addEventListener('click', () => {
        if (this.callbacks.onToggleInspect) this.callbacks.onToggleInspect();
      });
      const btnClearMeasures = document.getElementById('hud-clear-measures');
      if (btnClearMeasures) btnClearMeasures.addEventListener('click', () => {
        if (this.callbacks.onClearMeasures) this.callbacks.onClearMeasures();
      });
      return;
    }

    const count = this.selectedPoints.length;
    let html = '';

    const depthText = this.isFullDepth ? `Xuyên suốt (${this.customDepth} ô)` : `${this.customDepth} ô`;

    let stepBadge = '🎯 1 Ô';
    if (Math.abs(this.snapStep - 0.5) < 0.01) stepBadge = '✂️ 1/2 Ô';
    else if (Math.abs(this.snapStep - 0.25) < 0.01) stepBadge = '✂️ 1/4 Ô';
    else if (Math.abs(this.snapStep - 0.125) < 0.01) stepBadge = '✂️ 1/8 Ô';

    const quickControlsHtml = `
      <div style="display:inline-flex; align-items:center; gap:5px; margin-left:6px;">
        <button class="hud-btn-toggle" id="hud-toggle-step" title="Đổi bước lưới (1 ➔ 1/2 ➔ 1/4 ➔ 1/8) (Phím tắt: S)">${stepBadge}</button>
        <button class="hud-btn-toggle" id="hud-toggle-grid" title="Bật/Tắt lưới ô vuông trên mặt khối (Phím tắt: G)">🔲 Ô Vuông</button>
      </div>
    `;

    if (this.mode === 'poly') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>CÁC ĐIỂM LIÊN TIẾP</b> trên khối (3, 4, 5, 6... điểm) để tự kết nối thành vùng kín</span>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count < 3) {
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Đã chọn ${count} điểm</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ ${count + 1}</b> để tạo thành hình kín...</span>
            <button class="hud-btn-action" id="hud-remove-point">↩️ Xóa điểm</button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      } else {
        html = `
          <div class="hud-actions">
            <div class="hud-coords">⬡ Đa giác / Khối kín (${count} điểm tự nối)</div>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT PHẦN TRONG ĐÓ (Enter)
            </button>
            <button class="hud-btn-action" id="hud-remove-point" title="Xóa điểm gần nhất (Backspace)">
              ↩️ Xóa điểm cuối
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      }

    } else if (this.mode === 'slant') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>ĐIỂM 1</b> trên mặt khối (Vát theo 2 điểm hoặc 3 điểm)</span>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Điểm 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Hãy <b>Click chọn ĐIỂM 2</b> (hoặc click tiếp Điểm 3 để tạo Mặt Phẳng 3D)...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count === 2) {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        const dirText = this.slantCutAbove ? 'Phía TRÊN' : 'Phía DƯỚI';
        html = `
          <div class="hud-actions">
            <div class="hud-coords">🟢 (${p1.x},${p1.y},${p1.z}) ➔ 🔵 (${p2.x},${p2.y},${p2.z})</div>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT VÁT (Enter)
            </button>
            <button class="hud-btn-action" id="hud-toggle-dir" title="Đổi phía không gian cắt">
              🔄 ${dirText}
            </button>
            <span style="font-size:12px; opacity:0.85; margin:0 4px;">👉 Hoặc click <b>ĐIỂM 3</b> để vát mặt phẳng 3D</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
            ${quickControlsHtml}
          </div>
        `;
      } else {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        const p3 = this.selectedPoints[2];
        const isCoplanar = this.cad.isCoplanarOnFace && this.cad.isCoplanarOnFace(p1, p2, p3);

        if (isCoplanar) {
          html = `
            <div class="hud-actions">
              <div class="hud-coords">📐 Rãnh tam giác: 🟢 (${p1.x},${p1.y},${p1.z}) ➔ 🔵 (${p2.x},${p2.y},${p2.z}) ➔ 🟡 (${p3.x},${p3.y},${p3.z})</div>
              <div class="hud-stepper">
                <span>Độ sâu:</span>
                <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
                <b id="depth-display">${depthText}</b>
                <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
                <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
              </div>
              <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
                ✂️ CẮT RÃNH TAM GIÁC (Enter)
              </button>
              <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
              ${quickControlsHtml}
            </div>
          `;
        } else {
          const dirText = this.slantCutAbove ? 'Bên Phải/Trên' : 'Bên Trái/Dưới';
          const boundText = this.isFullDepth ? 'Xuyên suốt khối' : 'Giới hạn theo điểm';
          html = `
            <div class="hud-actions">
              <div class="hud-coords">📐 Mặt phẳng 3D: 🟢 (${p1.x},${p1.y},${p1.z}) ➔ 🔵 (${p2.x},${p2.y},${p2.z}) ➔ 🟡 (${p3.x},${p3.y},${p3.z})</div>
              <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
                ✂️ CẮT MẶT PHẲNG (Enter)
              </button>
              <button class="hud-btn-action" id="hud-toggle-dir" title="Đổi chiều mặt phẳng cắt">
                🔄 Đổi bên vát (Tab)
              </button>
              <button class="hud-btn-toggle" id="hud-toggle-bound" title="Nhấn để đổi giữa giới hạn theo phạm vi điểm và xuyên suốt">
                🎯 ${boundText}
              </button>
              <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
              ${quickControlsHtml}
            </div>
          `;
        }
      }

    } else if (this.mode === 'corner') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>3 ĐIỂM</b> trên 3 cạnh xuất phát từ góc cần vát</span>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Điểm 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ HAI</b> trên cạnh thứ hai...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count === 2) {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">2 Điểm</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ BA</b> trên cạnh thứ ba...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      } else {
        const params = this.getCornerParams();
        const o = params ? params.corner : { x: '?', y: '?', z: '?' };
        html = `
          <div class="hud-actions">
            <div class="hud-coords">🔺 Đỉnh góc: (${o.x}, ${o.y}, ${o.z})</div>
            <button class="hud-btn-action" id="hud-toggle-corner" title="Đổi hướng đỉnh góc vát">🔄 Đổi góc</button>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT GÓC (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
            ${quickControlsHtml}
          </div>
        `;
      }

    } else if (this.mode === 'box') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click chọn <b>GÓC 1</b> của rãnh hộp trên mặt khối</span>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Góc 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Click chọn <b>GÓC 2 ĐỐI DIỆN</b>...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      } else {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        html = `
          <div class="hud-actions">
            <div class="hud-coords">📦 (${p1.x},${p1.y},${p1.z}) ➔ (${p2.x},${p2.y},${p2.z})</div>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ KHOÉT HỘP (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
            ${quickControlsHtml}
          </div>
        `;
      }

    } else if (this.mode === 'vgroove') {
      if (count === 0) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bước 1</span>
            <span>Click <b>3 điểm</b> (Đỉnh & 2 chân đáy) theo ô lưới trên mặt khối</span>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count === 1) {
        const p = this.selectedPoints[0];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">Điểm 1 (${p.x}, ${p.y}, ${p.z})</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ HAI</b>...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      } else if (count === 2) {
        const p1 = this.selectedPoints[0];
        const p2 = this.selectedPoints[1];
        html = `
          <div class="hud-step">
            <span class="hud-badge done">2 Điểm</span>
            <span>👉 Click tiếp <b>ĐIỂM THỨ BA</b>...</span>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️ Hủy</button>
            ${quickControlsHtml}
          </div>
        `;
      } else {
        const vPts = this.getVGroovePoints();
        const ax = vPts ? vPts.apex : this.selectedPoints[0];
        html = `
          <div class="hud-actions">
            <div class="hud-coords">🔻 Đỉnh V: (${ax.x}, ${ax.y}, ${ax.z})</div>
            <button class="hud-btn-action" id="hud-toggle-apex" title="Đổi điểm làm đỉnh nhọn">🔄 Đổi đỉnh</button>
            <div class="hud-stepper">
              <span>Độ sâu:</span>
              <button class="step-btn" id="depth-minus" title="Giảm độ sâu">➖</button>
              <b id="depth-display">${depthText}</b>
              <button class="step-btn" id="depth-plus" title="Tăng độ sâu">➕</button>
              <button class="hud-btn-toggle" id="depth-full">Xuyên suốt</button>
            </div>
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ CẮT RÃNH V (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
            ${quickControlsHtml}
          </div>
        `;
      }

    } else if (this.mode === 'hole') {
      const dia = Number((this.holeRadius * 2).toFixed(2));
      const depthVal = Number(this.holeDepth.toFixed(2));
      const holeControlsHtml = `
        <div class="hud-stepper" style="gap:6px;">
          <span>Ø:</span>
          <input type="number" id="hud-hole-dia" value="${dia}" min="0.2" max="300" step="0.5" style="width:58px;background:#0f172a;color:#fff;border:1px solid #38bdf8;border-radius:6px;padding:2px 6px;font-weight:700;">
          <span>(R=${Number(this.holeRadius.toFixed(2))})</span>
          <button class="hud-btn-toggle ${this.holeThrough ? 'active' : ''}" id="hud-hole-through">${this.holeThrough ? 'Xuyên suốt' : 'Theo sâu'}</button>
          ${this.holeThrough ? '' : `<input type="number" id="hud-hole-depth" value="${depthVal}" min="0.2" max="300" step="0.5" style="width:54px;background:#0f172a;color:#fff;border:1px solid #38bdf8;border-radius:6px;padding:2px 6px;font-weight:700;">`}
        </div>
      `;
      if (!this.holeCenter) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Khoan Lỗ</span>
            <span>Click chọn <b>Tâm lỗ tròn</b> trên mặt khối</span>
            ${holeControlsHtml}
            ${quickControlsHtml}
          </div>
        `;
      } else {
        const c = this.holeCenter;
        html = `
          <div class="hud-actions">
            <div class="hud-coords">⭕ Tâm (${Number(c.x.toFixed(2))}, ${Number(c.y.toFixed(2))}, ${Number(c.z.toFixed(2))})</div>
            ${holeControlsHtml}
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ KHOAN LỖ (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
            ${quickControlsHtml}
          </div>
        `;
      }

    } else if (this.mode === 'fillet3d') {
      const rVal = Number(this.filletRadius.toFixed(2));
      const filletControlsHtml = `
        <div class="hud-stepper" style="gap:6px;">
          <span>Bán kính R:</span>
          <button class="step-btn" id="hud-fillet-minus" title="Giảm R">➖</button>
          <input type="number" id="hud-fillet-r" value="${rVal}" min="0.2" max="200" step="0.5" style="width:58px;background:#0f172a;color:#fff;border:1px solid #38bdf8;border-radius:6px;padding:2px 6px;font-weight:700;">
          <button class="step-btn" id="hud-fillet-plus" title="Tăng R">➕</button>
        </div>
      `;
      if (!this.selectedFilletEdge) {
        html = `
          <div class="hud-step">
            <span class="hud-badge pulse">Bo Cạnh</span>
            <span>Click vào <b>1 cạnh sắc</b> trên khối 3D để bo tròn</span>
            ${filletControlsHtml}
            ${quickControlsHtml}
          </div>
        `;
      } else {
        const e = this.selectedFilletEdge;
        const len = e.p1.distanceTo(e.p2).toFixed(2);
        html = `
          <div class="hud-actions">
            <div class="hud-coords">╭ Cạnh dài ${len}</div>
            ${filletControlsHtml}
            <button class="hud-btn-action hud-btn-cut" id="hud-cut-btn">
              ✂️ BO TRÒN CẠNH (Enter)
            </button>
            <button class="hud-btn-cancel" id="hud-cancel-btn">✖️</button>
            ${quickControlsHtml}
          </div>
        `;
      }
    }

    this.hudElement.innerHTML = html;

    const btnToggleStep = document.getElementById('hud-toggle-step');
    if (btnToggleStep) btnToggleStep.addEventListener('click', () => this.toggleSnapStep());

    const btnToggleGrid = document.getElementById('hud-toggle-grid');
    if (btnToggleGrid) btnToggleGrid.addEventListener('click', () => {
      if (this.callbacks.onToggleGridSquares) this.callbacks.onToggleGridSquares();
    });

    const btnCut = document.getElementById('hud-cut-btn');
    if (btnCut) btnCut.addEventListener('click', () => this.executeCurrentCut());

    const btnCancel = document.getElementById('hud-cancel-btn');
    if (btnCancel) btnCancel.addEventListener('click', () => this.clearSelection());

    const btnRemovePt = document.getElementById('hud-remove-point');
    if (btnRemovePt) btnRemovePt.addEventListener('click', () => this.removeLastPoint());

    const btnToggleBound = document.getElementById('hud-toggle-bound');
    if (btnToggleBound) btnToggleBound.addEventListener('click', () => {
      this.isFullDepth = !this.isFullDepth;
      this.updatePreviewForPlane3Points();
      this.updateHUD();
    });

    const btnToggleDir = document.getElementById('hud-toggle-dir');
    if (btnToggleDir) btnToggleDir.addEventListener('click', () => this.toggleSlantDirection());

    const btnToggleApex = document.getElementById('hud-toggle-apex');
    if (btnToggleApex) btnToggleApex.addEventListener('click', () => this.cycleVApex());

    const btnToggleCorner = document.getElementById('hud-toggle-corner');
    if (btnToggleCorner) btnToggleCorner.addEventListener('click', () => this.cycleCornerO());

    const btnDepthMinus = document.getElementById('depth-minus');
    if (btnDepthMinus) btnDepthMinus.addEventListener('click', () => this.changeDepth(-1));

    const btnDepthPlus = document.getElementById('depth-plus');
    if (btnDepthPlus) btnDepthPlus.addEventListener('click', () => this.changeDepth(1));

    const btnDepthFull = document.getElementById('depth-full');
    if (btnDepthFull) btnDepthFull.addEventListener('click', () => this.setFullDepth());

    const btnMinus = document.getElementById('step-minus');
    if (btnMinus) btnMinus.addEventListener('click', () => {
      this.adjustCornerDelta('dx', -1);
      this.adjustCornerDelta('dy', -1);
      this.adjustCornerDelta('dz', -1);
    });

    const btnPlus = document.getElementById('step-plus');
    if (btnPlus) btnPlus.addEventListener('click', () => {
      this.adjustCornerDelta('dx', 1);
      this.adjustCornerDelta('dy', 1);
      this.adjustCornerDelta('dz', 1);
    });

    const inputHoleDia = document.getElementById('hud-hole-dia');
    if (inputHoleDia) {
      inputHoleDia.addEventListener('input', () => {
        const val = parseFloat(inputHoleDia.value);
        if (!isNaN(val) && val > 0.1) {
          this.holeRadius = val * 0.5;
          this.updatePreviewForHole();
        }
      });
      inputHoleDia.addEventListener('change', () => this.updateHUD());
    }

    const btnHoleThrough = document.getElementById('hud-hole-through');
    if (btnHoleThrough) btnHoleThrough.addEventListener('click', () => {
      this.holeThrough = !this.holeThrough;
      this.updatePreviewForHole();
      this.updateHUD();
    });

    const inputHoleDepth = document.getElementById('hud-hole-depth');
    if (inputHoleDepth) {
      inputHoleDepth.addEventListener('input', () => {
        const val = parseFloat(inputHoleDepth.value);
        if (!isNaN(val) && val > 0.1) {
          this.holeDepth = val;
          this.updatePreviewForHole();
        }
      });
    }

    const inputFilletR = document.getElementById('hud-fillet-r');
    if (inputFilletR) {
      inputFilletR.addEventListener('input', () => {
        const val = parseFloat(inputFilletR.value);
        if (!isNaN(val) && val > 0.1) {
          this.filletRadius = val;
          this.updatePreviewForFillet();
        }
      });
      inputFilletR.addEventListener('change', () => this.updateHUD());
    }

    const btnFilletMinus = document.getElementById('hud-fillet-minus');
    if (btnFilletMinus) btnFilletMinus.addEventListener('click', () => {
      this.filletRadius = Math.max(0.25, Number((this.filletRadius - this.snapStep).toFixed(3)));
      this.updatePreviewForFillet();
      this.updateHUD();
    });

    const btnFilletPlus = document.getElementById('hud-fillet-plus');
    if (btnFilletPlus) btnFilletPlus.addEventListener('click', () => {
      this.filletRadius = Number((this.filletRadius + this.snapStep).toFixed(3));
      this.updatePreviewForFillet();
      this.updateHUD();
    });
  }
}
