/**
 * Storage Manager - Tự động lưu khối 3D & bản vẽ 2D vào IndexedDB / localStorage.
 * Giúp người dùng khi tải lại trang (F5) hoặc vô tình đóng tab không bao giờ bị mất bài.
 */

const DB_NAME = 'MyCAD_AutoSave_DB';
const DB_VERSION = 1;
const STORE_NAME = 'cad_state';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Lưu dữ liệu dạng key-value vào IndexedDB với fallback sang localStorage
 */
export async function saveProjectState(key, data) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(data, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    try {
      localStorage.setItem('mycad_' + key, JSON.stringify(data));
    } catch (e) {
      console.warn('Fallback localStorage save failed:', e);
    }
  }
}

/**
 * Tải dữ liệu từ IndexedDB với fallback sang localStorage
 */
export async function loadProjectState(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result !== undefined) {
          resolve(req.result);
        } else {
          try {
            const raw = localStorage.getItem('mycad_' + key);
            resolve(raw ? JSON.parse(raw) : null);
          } catch (e) {
            resolve(null);
          }
        }
      };
      req.onerror = () => {
        try {
          const raw = localStorage.getItem('mycad_' + key);
          resolve(raw ? JSON.parse(raw) : null);
        } catch (e) {
          resolve(null);
        }
      };
    });
  } catch (err) {
    try {
      const raw = localStorage.getItem('mycad_' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
}

/**
 * Xóa toàn bộ dữ liệu tự lưu
 */
export async function clearProjectState() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch (e) {}
  try {
    localStorage.removeItem('mycad_state_3d');
    localStorage.removeItem('mycad_state_2d');
    localStorage.removeItem('mycad_app_mode');
  } catch (e) {}
}
