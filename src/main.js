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

// Lights
const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(30, 45, 30);
scene.add(dirLight);

const dirLight2 = new THREE.DirectionalLight(0x94a3b8, 0.4);
dirLight2.position.set(-20, -10, -20);
scene.add(dirLight2);

// --- MODULES & STATE ---
const cad = new CadEngine();
const gridOverlay = new GridOverlay(scene);
const preview = new CutterPreview(scene);

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

  gridOverlay.update(W, H, D);
  gridOverlay.setVisible(typeof picker !== 'undefined' && picker ? picker.mode !== 'view' : false);
  centerCamera();
}

function updateCameraFrustum() {
  const asp = container.clientWidth / container.clientHeight;
  frustumSize = Math.max(12, Math.max(W, H, D) * 1.8);
  camera.left = -frustumSize * asp / 2;
  camera.right = frustumSize * asp / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
}

function centerCamera() {
  updateCameraFrustum();
  controls.target.set(W / 2, H / 2, D / 2);
  setCameraIsometric();
}

function setCameraIsometric() {
  const dist = Math.max(W, H, D) * 3;
  camera.position.set(W / 2 + dist, H / 2 + dist, D / 2 + dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  controls.update();
  setActiveViewButton('view-iso');
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
  onPointsChanged: () => {},
  onModeChange: (mode) => {
    syncModeUI(mode);
    gridOverlay.setVisible(mode !== 'view');
  }
});

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
  { name: 'Đứng (Front)', getPos: (dist) => new THREE.Vector3(W / 2, H / 2, D / 2 + dist) },
  { name: 'Cạnh Phải (Right)', getPos: (dist) => new THREE.Vector3(W / 2 + dist, H / 2, D / 2) },
  { name: 'Sau (Back)', getPos: (dist) => new THREE.Vector3(W / 2, H / 2, D / 2 - dist) },
  { name: 'Cạnh Trái (Left)', getPos: (dist) => new THREE.Vector3(W / 2 - dist, H / 2, D / 2) }
];

function applyHorizontalView(stepNext = false) {
  const btn = document.getElementById('view-horizontal');
  if (stepNext) {
    horizontalViewIndex = (horizontalViewIndex + 1) % horizontalViews.length;
  }
  const view = horizontalViews[horizontalViewIndex];
  if (btn) {
    btn.innerHTML = `🔄 ${view.name}`;
    btn.title = `Góc chiếu ngang 90° - Đang ở [${view.name}]. Click để xoay 90° tiếp`;
  }
  const dist = Math.max(W, H, D) * 4;
  controls.target.set(W / 2, H / 2, D / 2);
  camera.position.copy(view.getPos(dist));
  camera.up.set(0, 1, 0);
  camera.lookAt(controls.target);
  controls.update();
  setActiveViewButton('view-horizontal');
}

const btnHorizontal = document.getElementById('view-horizontal');
if (btnHorizontal) {
  btnHorizontal.addEventListener('click', () => {
    const isAlreadyActive = btnHorizontal.classList.contains('active');
    applyHorizontalView(isAlreadyActive);
  });
}

document.getElementById('view-top').addEventListener('click', () => {
  const dist = Math.max(W, H, D) * 4;
  camera.position.set(W / 2, H / 2 + dist, D / 2);
  camera.up.set(0, 0, -1);
  controls.target.set(W / 2, H / 2, D / 2);
  camera.lookAt(controls.target);
  controls.update();
  setActiveViewButton('view-top');
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

// --- KHỞI CHẠY LẦN ĐẦU ---
resetBaseBlock();
picker.setMode('view');
gridOverlay.setVisible(false);

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
