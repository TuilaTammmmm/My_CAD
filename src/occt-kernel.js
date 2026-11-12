import * as THREE from 'three';
import { Brush } from 'three-bvh-csg';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import * as replicad from 'replicad';
import opencascade from 'replicad-opencascadejs';
import opencascadeWasm from 'replicad-opencascadejs/wasm?url';

if (!THREE.BufferGeometry.prototype.computeBoundsTree) {
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

let initPromise = null;
let ocInstance = null;
let ocReady = false;
let ocError = null;

/**
 * Initialize OpenCascade (replicad) WebAssembly kernel once.
 * @returns {Promise<{ oc: any, replicad: typeof replicad }>}
 */
export function initOCCT() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const oc = await opencascade({
        locateFile: () => opencascadeWasm
      });
      replicad.setOC(oc);
      ocInstance = oc;
      ocReady = true;
      return { oc, replicad };
    } catch (err) {
      ocError = err;
      console.error('OCCT WASM init failed:', err);
      throw err;
    }
  })();

  return initPromise;
}

export function isOCCTReady() {
  return ocReady;
}

export function getOCCTError() {
  return ocError;
}

export function getOC() {
  return ocInstance;
}

export { replicad };

/**
 * Convert a replicad Shape3D (already in Three.js Y-up coordinates)
 * into a Three.js Brush with exact B-Rep mesh + exact B-Rep edge polylines.
 */
export function replicadToBrush(shape3d, material, options = {}) {
  const tolerance = options.tolerance ?? 0.2;
  const angularTolerance = options.angularTolerance ?? 0.25;

  const meshData = shape3d.mesh({ tolerance, angularTolerance });
  const edgeData = shape3d.meshEdges({ tolerance, angularTolerance });

  const geom = new THREE.BufferGeometry();
  const posArr = new Float32Array(meshData.vertices);
  const normArr = new Float32Array(meshData.normals);
  const uvArr = new Float32Array((posArr.length / 3) * 2);

  geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geom.setIndex(meshData.triangles);
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  try {
    geom.computeBoundsTree();
  } catch (e) {}

  const brush = new Brush(geom, material);
  brush.updateMatrixWorld();

  const edgeGeom = new THREE.BufferGeometry();
  edgeGeom.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(edgeData.lines), 3)
  );
  edgeGeom.computeBoundingBox();
  edgeGeom.computeBoundingSphere();

  brush._replicadShape = shape3d;
  brush._occtEdges = edgeGeom;
  brush.userData.isBRep = true;

  return brush;
}
