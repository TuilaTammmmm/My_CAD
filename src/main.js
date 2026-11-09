import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Brush } from 'three-bvh-csg';
import { CadEngine } from './cad-engine.js';
import { GridOverlay } from './grid-overlay.js';
import { CutterPreview } from './preview.js';
import { InteractivePicker } from './picker.js';
import { exportToOBJ } from './exporter.js';
import { ProjectionEngine } from './projection-engine.js';
import { CAD2DEditor } from './cad2d-editor.js';
import { DimensionOverlay } from './dimension-overlay.js';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

inject();
injectSpeedInsights();
// --- INITIALIZE THREE.JS ---
const container = document.getElementById('viewport-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f19);

let W = 6, H = 4, D = 4;

const aspect = container.clientWidth / container.clientHeight;
let frustumSize = Math.max(12, Math.max(W, H, D) * 1.8);
const camera = new THREE.OrthographicCamera(
  -frustumSize * aspect / 2, frustumSize * aspect / 2,
  frustumSize / 2, -frustumSize / 2,
  0.1, 1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN
};

// Lights - Đổ bóng phân 3 tầng kỹ thuật (Technical 3-Tier Isometric Shading)
// Mặt Trên (Top: ~93% sáng) - Mặt Đứng (Front: ~77% sáng vừa) - Mặt Cạnh (Side: ~52% bóng đổ)
const ambLight = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambLight);

// Nguồn sáng từ đỉnh: Rọi sáng Mặt Trên
const topLight = new THREE.DirectionalLight(0xffffff, 0.60);
topLight.position.set(0, 60, 15);
scene.add(topLight);

// Nguồn sáng phía trước: Rọi sáng Mặt Đứng
const frontLight = new THREE.DirectionalLight(0xe2e8f0, 0.38);
frontLight.position.set(-10, 15, 55);
scene.add(frontLight);

// Nguồn sáng phụ bên cạnh: Đổ bóng kỹ thuật Mặt Cạnh
const sideLight = new THREE.DirectionalLight(0x94a3b8, 0.18);
sideLight.position.set(50, 10, -5);
scene.add(sideLight);

// --- MODULES & STATE ---
const cad = new CadEngine();
const gridOverlay = new GridOverlay(scene);
const preview = new CutterPreview(scene);
const dimOverlay = new DimensionOverlay(scene, camera);

let currentBrush = null;
let currentEdges = null;
const modelGroup = new THREE.Group();
scene.add(modelGroup);

// History (Undo / Redo)
let history = [];
let historyIndex = -1;

function saveHistory(brush) {
  history = history.slice(0, historyIndex + 1);
  const clone = brush.clone();
  clone.geometry = brush.geometry.clone();
  history.push(clone);
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.disabled = (historyIndex <= 0);
  if (btnRedo) btnRedo.disabled = (historyIndex >= history.length - 1);
}

function setModel(brush, recordHistory = true) {
  if (currentBrush) {
    modelGroup.remove(currentBrush);
    if (currentEdges) modelGroup.remove(currentEdges);
    currentBrush.geometry.dispose();
  }

  currentBrush = brush;
  currentEdges = cad.createEdges(currentBrush);

  modelGroup.add(currentBrush);
  modelGroup.add(currentEdges);

  if (recordHistory) {
    saveHistory(currentBrush);
  }

  const snapStep = (typeof picker !== 'undefined' && picker) ? picker.snapStep : 1.0;
  gridOverlay.update(W, H, D, currentBrush, snapStep);
  dimOverlay.updateBounds(W, H, D, snapStep);

  if (picker) {
    picker.updateModel(currentBrush, W, H, D);
  }
}

// Reset / Khởi tạo lại khối gốc ban đầu
function resetBaseBlock() {
  W = parseInt(document.getElementById('dim-w').value) || 6;
  H = parseInt(document.getElementById('dim-h').value) || 4;
  D = parseInt(document.getElementById('dim-d').value) || 4;

  history = [];
  historyIndex = -1;

  const base = cad.createBaseBlock(W, H, D);
  setModel(base, true);

  const snapStep = (typeof picker !== 'undefined' && picker) ? picker.snapStep : 1.0;
  gridOverlay.update(W, H, D, currentBrush, snapStep);
  gridOverlay.setVisible(typeof picker !== 'undefined' && picker ? picker.mode !== 'view' : false);
  dimOverlay.updateBounds(W, H, D, snapStep);
  centerCamera();
}

function updateCameraFrustumForView(viewKey = 'iso') {
  const asp = container.clientWidth / container.clientHeight;
  const maxDim = Math.max(W, H, D);

  let baseSpan;
  if (viewKey === 'front' || viewKey === 'back') {
    baseSpan = Math.max(H + 3.2, (W + 3.2) / asp);
  } else if (viewKey === 'right' || viewKey === 'left') {
    baseSpan = Math.max(H + 3.2, (D + 3.2) / asp);
  } else if (viewKey === 'top') {
    baseSpan = Math.max(D + 3.2, (W + 3.2) / asp);
  } else {
    baseSpan = maxDim * 1.85;
  }

  frustumSize = Math.max(10, baseSpan * 1.15);
  camera.left = -frustumSize * asp / 2;
  camera.right = frustumSize * asp / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
}

function updateCameraFrustum() {
  updateCameraFrustumForView(dimOverlay ? dimOverlay.currentView : 'iso');
}

function centerCamera() {
  controls.target.set(W / 2, H / 2, D / 2);
  setCameraIsometric();
}

function setCameraIsometric() {
  updateCameraFrustumForView('iso');
  const dist = Math.max(W, H, D) * 3;
  controls.target.set(W / 2, H / 2, D / 2);
  camera.position.set(W / 2 + dist, H / 2 + dist, D / 2 + dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  controls.update();
  setActiveViewButton('view-iso');
  dimOverlay.setView('iso');
  gridOverlay.setView('iso');
}

function setActiveViewButton(id) {
  document.querySelectorAll('#view-iso, #view-horizontal, #view-top').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(id);
  if (btn) btn.classList.add('active');
}

// --- INTERACTIVE PICKER (CHỌN GÓC TRÊN HÌNH TRỰC TIẾP) ---
const picker = new InteractivePicker(scene, camera, renderer, controls, cad, preview, {
  onCutExecute: (newBrush) => {
    setModel(newBrush, true);
  },
  onPointsChanged: () => { },
  onModeChange: (mode) => {
    syncModeUI(mode);
    gridOverlay.setVisible(mode !== 'view');
  },
  onSnapStepChange: (step) => {
    syncSnapStepUI(step);
    gridOverlay.update(W, H, D, currentBrush, step);
    dimOverlay.updateBounds(W, H, D, step);
  },
  onToggleGridSquares: () => {
    toggleGridSquaresUI();
  },
  onToggleDim: () => {
    toggleDimUI();
  }
});

// UI helpers cho bước cắt 0.5 (cắt giữa ô), bật/tắt ô vuông và số đo
function syncSnapStepUI(step) {
  const btn = document.getElementById('btn-toggle-snap-step');
  const lbl = document.getElementById('lbl-snap-step');
  const isHalf = (step === 0.5);
  if (btn) btn.classList.toggle('active', isHalf);
  if (lbl) lbl.textContent = isHalf ? 'Giữa Ô: BẬT' : 'Giữa Ô: TẮT';
}

function toggleSnapStepUI() {
  const newStep = picker.toggleSnapStep();
  syncSnapStepUI(newStep);
}

function syncGridSquaresUI(visible) {
  const btn = document.getElementById('btn-toggle-grid-squares');
  const lbl = document.getElementById('lbl-grid-squares');
  if (btn) btn.classList.toggle('active', visible);
  if (lbl) lbl.textContent = visible ? 'Ô Vuông: BẬT' : 'Ô Vuông: TẮT';
}

function toggleGridSquaresUI() {
  const visible = gridOverlay.toggleGridSquares();
  syncGridSquaresUI(visible);
}

function syncDimUI(enabled) {
  const btn = document.getElementById('btn-toggle-dim');
  const lbl = document.getElementById('lbl-toggle-dim');
  if (btn) btn.classList.toggle('active', enabled);
  if (lbl) lbl.textContent = enabled ? 'Số Đo: BẬT' : 'Số Đo: TẮT';
}

function toggleDimUI() {
  const enabled = dimOverlay.toggle();
  syncDimUI(enabled);
}

document.getElementById('btn-toggle-snap-step')?.addEventListener('click', toggleSnapStepUI);
document.getElementById('btn-toggle-grid-squares')?.addEventListener('click', toggleGridSquaresUI);
document.getElementById('btn-toggle-dim')?.addEventListener('click', toggleDimUI);

// Đồng bộ trạng thái active của các nút chế độ trên thanh công cụ
function syncModeUI(mode) {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
  });
}

// Lắng nghe sự kiện chuyển chế độ thao tác
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-mode');
    picker.setMode(mode);
  });
});

// POPOVER CÀI ĐẶT KÍCH THƯỚC KHỐI
const dimPopover = document.getElementById('dim-popover');
const btnOpenDim = document.getElementById('btn-open-dim');
const btnCloseDim = document.getElementById('btn-close-dim');

if (btnOpenDim && dimPopover) {
  btnOpenDim.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShown = dimPopover.style.display !== 'none';
    dimPopover.style.display = isShown ? 'none' : 'flex';
  });
}

if (btnCloseDim && dimPopover) {
  btnCloseDim.addEventListener('click', () => {
    dimPopover.style.display = 'none';
  });
}

window.addEventListener('click', (e) => {
  if (dimPopover && dimPopover.style.display !== 'none') {
    if (!dimPopover.contains(e.target) && e.target !== btnOpenDim) {
      dimPopover.style.display = 'none';
    }
  }
});

// Nút Tạo lại khối gốc (Reset)
document.getElementById('btn-reset-block').addEventListener('click', () => {
  resetBaseBlock();
  if (dimPopover) dimPopover.style.display = 'none';
});

// Undo / Redo
function performUndo() {
  if (historyIndex > 0) {
    historyIndex--;
    const brush = history[historyIndex].clone();
    brush.geometry = history[historyIndex].geometry.clone();
    setModel(brush, false);
    updateHistoryButtons();
  }
}

function performRedo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    const brush = history[historyIndex].clone();
    brush.geometry = history[historyIndex].geometry.clone();
    setModel(brush, false);
    updateHistoryButtons();
  }
}

document.getElementById('btn-undo').addEventListener('click', performUndo);
document.getElementById('btn-redo').addEventListener('click', performRedo);

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      performRedo();
    } else {
      performUndo();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    performRedo();
  }
});

// Export OBJ
document.getElementById('btn-export-obj').addEventListener('click', () => {
  if (currentBrush) {
    exportToOBJ(currentBrush, `technical_block_${W}x${H}x${D}.obj`);
  }
});

// Import OBJ
const btnImportObj = document.getElementById('btn-import-obj');
const inputImportObj = document.getElementById('input-import-obj');

if (btnImportObj && inputImportObj) {
  btnImportObj.addEventListener('click', () => {
    inputImportObj.click();
  });

  inputImportObj.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        const loader = new OBJLoader();
        const objGroup = loader.parse(text);

        const geometries = [];
        objGroup.traverse((child) => {
          if (child.isMesh && child.geometry) {
            const g = child.geometry.clone();
            child.updateMatrixWorld();
            g.applyMatrix4(child.matrixWorld);
            geometries.push(g.index ? g.toNonIndexed() : g);
          }
        });

        if (geometries.length === 0) {
          alert('Không tìm thấy dữ liệu khối 3D (Mesh) trong file OBJ đã chọn!');
          return;
        }

        let mergedGeom = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
        mergedGeom.computeVertexNormals();
        mergedGeom.computeBoundingBox();

        // Đưa góc min về (0, 0, 0)
        const bbox = mergedGeom.boundingBox;
        mergedGeom.translate(-bbox.min.x, -bbox.min.y, -bbox.min.z);
        mergedGeom.computeBoundingBox();

        if (!mergedGeom.attributes.uv) {
          const uvCount = mergedGeom.attributes.position.count * 2;
          mergedGeom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvCount), 2));
        }

        const rawW = mergedGeom.boundingBox.max.x - mergedGeom.boundingBox.min.x;
        const rawH = mergedGeom.boundingBox.max.y - mergedGeom.boundingBox.min.y;
        const rawD = mergedGeom.boundingBox.max.z - mergedGeom.boundingBox.min.z;

        W = Math.max(1, Math.round(rawW));
        H = Math.max(1, Math.round(rawH));
        D = Math.max(1, Math.round(rawD));

        const dimW = document.getElementById('dim-w');
        const dimH = document.getElementById('dim-h');
        const dimD = document.getElementById('dim-d');
        if (dimW) dimW.value = W;
        if (dimH) dimH.value = H;
        if (dimD) dimD.value = D;

        const importedBrush = new Brush(mergedGeom, cad.material);
        importedBrush.updateMatrixWorld();

        history = [];
        historyIndex = -1;

        setModel(importedBrush, true);
        gridOverlay.update(W, H, D);
        gridOverlay.setVisible(picker ? picker.mode !== 'view' : false);
        centerCamera();

        e.target.value = '';
      } catch (err) {
        console.error('Lỗi khi nạp OBJ:', err);
        alert('Có lỗi xảy ra khi nạp file OBJ: ' + err.message);
      }
    };
    reader.readAsText(file);
  });
}

// Technical Views
document.getElementById('view-iso').addEventListener('click', setCameraIsometric);

// Gộp Chiếu Đứng và Chiếu Cạnh vào cùng 1 nút, nhấn để xoay góc nhìn ngang 90 độ
let horizontalViewIndex = 0;
const horizontalViews = [
  { name: 'Đứng (Front)', getPos: (dist, t) => new THREE.Vector3(t.x, t.y, t.z + dist), targetOffset: () => new THREE.Vector3(W / 2 - 0.5, H / 2 - 0.5, D / 2) },
  { name: 'Cạnh Phải (Right)', getPos: (dist, t) => new THREE.Vector3(t.x + dist, t.y, t.z), targetOffset: () => new THREE.Vector3(W / 2, H / 2 - 0.5, D / 2 + 0.5) },
  { name: 'Sau (Back)', getPos: (dist, t) => new THREE.Vector3(t.x, t.y, t.z - dist), targetOffset: () => new THREE.Vector3(W / 2 + 0.5, H / 2 - 0.5, D / 2) },
  { name: 'Cạnh Trái (Left)', getPos: (dist, t) => new THREE.Vector3(t.x - dist, t.y, t.z), targetOffset: () => new THREE.Vector3(W / 2, H / 2 - 0.5, D / 2 - 0.5) }
];

function applyHorizontalView(stepNext = false) {
  const btn = document.getElementById('view-horizontal');
  if (stepNext) {
    horizontalViewIndex = (horizontalViewIndex + 1) % horizontalViews.length;
  }
  const view = horizontalViews[horizontalViewIndex];
  if (btn) {
    const textSpan = btn.querySelector('.tool-text');
    if (textSpan) {
      textSpan.textContent = view.name;
    } else {
      btn.innerHTML = `🔄 ${view.name}`;
    }
    btn.title = `Góc chiếu ngang 90° - Đang ở [${view.name}]. Click để xoay 90° tiếp`;
  }
  const viewKeys = ['front', 'right', 'back', 'left'];
  const viewKey = viewKeys[horizontalViewIndex];

  updateCameraFrustumForView(viewKey);
  const target = view.targetOffset();
  controls.target.copy(target);

  const dist = Math.max(W, H, D) * 4;
  camera.position.copy(view.getPos(dist, target));
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  controls.update();

  setActiveViewButton('view-horizontal');
  dimOverlay.setView(viewKey);
  gridOverlay.setView(viewKey);
}

const btnHorizontal = document.getElementById('view-horizontal');
if (btnHorizontal) {
  btnHorizontal.addEventListener('click', () => {
    const isAlreadyActive = btnHorizontal.classList.contains('active');
    applyHorizontalView(isAlreadyActive);
  });
}

document.getElementById('view-top').addEventListener('click', () => {
  updateCameraFrustumForView('top');
  const target = new THREE.Vector3(W / 2 - 0.5, H / 2, D / 2 + 0.5);
  controls.target.copy(target);

  const dist = Math.max(W, H, D) * 4;
  camera.position.set(target.x, target.y + dist, target.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(controls.target);
  controls.update();

  setActiveViewButton('view-top');
  dimOverlay.setView('top');
  gridOverlay.setView('top');
});

// Tự động chuyển đổi hiển thị số đo & lưới theo góc xoay tự do của chuột
let lastDetectedView = 'iso';
controls.addEventListener('change', () => {
  if (appMode !== '3d') return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  let detected = 'iso';
  if (Math.abs(dir.y + 1) < 0.08) {
    detected = 'top';
  } else if (Math.abs(dir.y) < 0.15) {
    if (dir.z < -0.92) detected = 'front';
    else if (dir.x < -0.92) detected = 'right';
    else if (dir.z > 0.92) detected = 'back';
    else if (dir.x > 0.92) detected = 'left';
  }

  if (detected !== lastDetectedView) {
    lastDetectedView = detected;
    dimOverlay.setView(detected);
    gridOverlay.setView(detected);

    if (detected === 'iso') {
      setActiveViewButton('view-iso');
    } else if (detected === 'top') {
      setActiveViewButton('view-top');
    } else {
      setActiveViewButton('view-horizontal');
      const idx = ['front', 'right', 'back', 'left'].indexOf(detected);
      if (idx !== -1) {
        horizontalViewIndex = idx;
        const btn = document.getElementById('view-horizontal');
        if (btn) {
          const textSpan = btn.querySelector('.tool-text');
          if (textSpan) textSpan.textContent = horizontalViews[idx].name;
        }
      }
    }
  }
});

// Window resize handler
window.addEventListener('resize', () => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  const asp = w / h;
  camera.left = -frustumSize * asp / 2;
  camera.right = frustumSize * asp / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// --- KHỞI TẠO 2D CAD VÀ BỘ CHUYỂN ĐỔI 3D <-> 2D ---
const projectionEngine = new ProjectionEngine(cad);
const canvas2d = document.getElementById('cad2d-canvas');
const cad2dEditor = new CAD2DEditor(canvas2d, projectionEngine);

let appMode = '3d'; // '3d' hoặc '2d'

function switchTo2D() {
  gridOverlay.setAllVisible(false);
  dimOverlay.setEnabled(false);
  appMode = '2d';
  document.getElementById('switch-to-3d')?.classList.remove('active');
  document.getElementById('switch-to-2d')?.classList.add('active');
  const appModeTitle = document.getElementById('app-mode-title');
  const appModeSub = document.getElementById('app-mode-sub');
  if (appModeTitle) appModeTitle.textContent = '2D CAD';
  if (appModeSub) appModeSub.textContent = '⚡ ĐỔI SANG 3D CAD';

  // Chuyển nội dung trong sidebar dùng chung: ẩn 3D, hiện 2D
  const sidebar3d = document.getElementById('sidebar-3d-tools');
  const sidebar2d = document.getElementById('sidebar-2d-tools');
  if (sidebar3d) sidebar3d.style.display = 'none';
  if (sidebar2d) sidebar2d.style.display = 'flex';

  // Ẩn HUD và helper 3D
  const hud = document.getElementById('interactive-hud');
  const helper = document.querySelector('.hud-helper');
  const popover = document.getElementById('dim-popover');
  if (hud) hud.style.display = 'none';
  if (helper) helper.style.display = 'none';
  if (popover) popover.style.display = 'none';

  // Hiện 2D canvas (không tự động tải đè từ 3D)
  cad2dEditor.show(currentBrush, { w: W, h: H, d: D });
}

function switchTo3D() {
  gridOverlay.setAllVisible(true);
  gridOverlay.setVisible(picker ? picker.mode !== 'view' : false);
  const dimBtn = document.getElementById('btn-toggle-dim');
  const isDimOn = dimBtn ? dimBtn.classList.contains('active') : true;
  dimOverlay.setEnabled(isDimOn);
  appMode = '3d';
  document.getElementById('switch-to-2d')?.classList.remove('active');
  document.getElementById('switch-to-3d')?.classList.add('active');
  const appModeTitle = document.getElementById('app-mode-title');
  const appModeSub = document.getElementById('app-mode-sub');
  if (appModeTitle) appModeTitle.textContent = 'My CAD';
  if (appModeSub) appModeSub.textContent = '⚡ ĐỔI SANG 2D CAD';

  // Chuyển nội dung trong sidebar dùng chung: hiện 3D, ẩn 2D
  const sidebar3d = document.getElementById('sidebar-3d-tools');
  const sidebar2d = document.getElementById('sidebar-2d-tools');
  if (sidebar3d) sidebar3d.style.display = 'flex';
  if (sidebar2d) sidebar2d.style.display = 'none';

  // Hiện lại HUD và helper 3D
  const hud = document.getElementById('interactive-hud');
  const helper = document.querySelector('.hud-helper');
  if (hud) hud.style.display = 'block';
  if (helper) helper.style.display = 'block';

  // Ẩn 2D canvas
  cad2dEditor.hide();
}

function toggleAppMode() {
  if (appMode === '3d') {
    switchTo2D();
  } else {
    switchTo3D();
  }
}

document.getElementById('btn-toggle-app-mode')?.addEventListener('click', toggleAppMode);
document.getElementById('switch-to-3d')?.addEventListener('click', switchTo3D);
document.getElementById('switch-to-2d')?.addEventListener('click', switchTo2D);

// Lắng nghe các nút chọn mặt phẳng 2D trong sidebar
document.querySelectorAll('.cad2d-plane-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cad2d-plane-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const plane = btn.getAttribute('data-plane');
    cad2dEditor.setPlane(plane);
  });
});

// Lắng nghe các nút công cụ nét vẽ 2D trong sidebar
document.querySelectorAll('.cad2d-tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cad2d-tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tool = btn.getAttribute('data-tool');
    cad2dEditor.setTool(tool);
  });
});

// Nút Undo / Redo 2D
document.getElementById('btn-2d-undo')?.addEventListener('click', () => {
  cad2dEditor.undo();
});
document.getElementById('btn-2d-redo')?.addEventListener('click', () => {
  cad2dEditor.redo();
});

// Cài đặt bán kính bo cung / đường tròn
document.getElementById('input-2d-radius')?.addEventListener('input', (e) => {
  const r = parseFloat(e.target.value);
  if (!isNaN(r) && r > 0) {
    cad2dEditor.setFilletRadius(r);
  }
});

// Nút chuyển đổi bắt dính Lưới 0.5 <-> Tự do Freeform
document.getElementById('btn-2d-toggle-snap')?.addEventListener('click', () => {
  cad2dEditor.toggleSnapMode();
});

// Nút chuyển đổi Khung CAD: Tắt (Tự Do) <-> Khung Phôi 3D <-> Khung A4 ISO
document.getElementById('btn-2d-toggle-frame')?.addEventListener('click', () => {
  cad2dEditor.cycleFrameMode();
});

// Nút lấy nét từ 3D
document.getElementById('btn-2d-sync-3d')?.addEventListener('click', () => {
  cad2dEditor.syncFrom3D();
});

// Nút xóa sạch mặt phẳng 2D hiện tại
document.getElementById('btn-2d-clear')?.addEventListener('click', () => {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ nét trên mặt phẳng này không?')) {
    cad2dEditor.clearPlane();
  }
});

// Nút xuất file ảnh kỹ thuật (.PNG)
document.getElementById('btn-2d-export-png')?.addEventListener('click', () => {
  cad2dEditor.exportPNG();
});

// Nút xuất file AutoCAD (.DXF)
document.getElementById('btn-2d-export-dxf')?.addEventListener('click', () => {
  cad2dEditor.exportDXF();
});

// --- KHỞI CHẠY LẦN ĐẦU ---
resetBaseBlock();
picker.setMode('view');
syncGridSquaresUI(gridOverlay.showGridSquares);
syncDimUI(dimOverlay.enabled);
syncSnapStepUI(picker.snapStep);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
