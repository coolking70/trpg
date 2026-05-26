/**
 * IndexedDB 通用 key-value 封装（Phase 23A）
 *
 * 解决 300+ 节点剧本 + 大型存档 + 元进度数据超出 localStorage 5MB 上限的问题。
 *
 * 设计：
 *   - 单一数据库 `trpg-store`，多个 object store（按用途分）
 *   - 简单的 get/put/delete/list/clear/has API
 *   - 浏览器无 IndexedDB 时返回 null（调用方自行回退到 localStorage）
 *
 * 用法：
 *   const store = new IndexedDBStore('presets');
 *   await store.put('preset_dark_forest', presetData);
 *   const p = await store.get('preset_dark_forest');
 *
 * 多个 store 同时存在时共享同一个 db connection，每个 store 名字对应一个 object store。
 */

const DB_NAME = 'trpg-store';
const DB_VERSION = 1;

// 预定义的 object store 名（必须在 onupgradeneeded 时一次性建出来）
const KNOWN_STORES = ['presets', 'saves', 'meta', 'archive'];

let _dbPromise = null;

/**
 * 打开数据库（lazy，复用）
 * @returns {Promise<IDBDatabase|null>} 浏览器无 IndexedDB 时返回 null
 */
function openDB() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (evt) => {
      const db = evt.target.result;
      for (const name of KNOWN_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);   // 用 key 显式传入（非 keyPath）
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

export class IndexedDBStore {
  /**
   * @param {string} storeName - 必须是 KNOWN_STORES 之一
   */
  constructor(storeName) {
    if (!KNOWN_STORES.includes(storeName)) {
      throw new Error(`未知 store: ${storeName}（请加入 IndexedDBStore.js 的 KNOWN_STORES）`);
    }
    this.storeName = storeName;
  }

  /** 检查 IndexedDB 是否可用 */
  static isAvailable() {
    return typeof indexedDB !== 'undefined';
  }

  async _tx(mode = 'readonly') {
    const db = await openDB();
    if (!db) return null;
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async get(key) {
    const store = await this._tx('readonly');
    if (!store) return null;
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(key, value) {
    const store = await this._tx('readwrite');
    if (!store) return false;
    return new Promise((resolve, reject) => {
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key) {
    const store = await this._tx('readwrite');
    if (!store) return false;
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async has(key) {
    const store = await this._tx('readonly');
    if (!store) return false;
    return new Promise((resolve, reject) => {
      const req = store.getKey(key);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 列出所有 key
   */
  async keys() {
    const store = await this._tx('readonly');
    if (!store) return [];
    return new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 列出所有 [key, value] 对
   */
  async entries() {
    const store = await this._tx('readonly');
    if (!store) return [];
    return new Promise((resolve, reject) => {
      const keysReq = store.getAllKeys();
      const valuesReq = store.getAll();
      let keysResult, valuesResult;
      keysReq.onsuccess = () => {
        keysResult = keysReq.result;
        if (valuesResult) resolve(keysResult.map((k, i) => [k, valuesResult[i]]));
      };
      valuesReq.onsuccess = () => {
        valuesResult = valuesReq.result;
        if (keysResult) resolve(keysResult.map((k, i) => [k, valuesResult[i]]));
      };
      keysReq.onerror = () => reject(keysReq.error);
      valuesReq.onerror = () => reject(valuesReq.error);
    });
  }

  /**
   * 清空整个 store
   */
  async clear() {
    const store = await this._tx('readwrite');
    if (!store) return false;
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * 估算当前 store 的总占用字节数（开发用，可能不精确）
   */
  async estimateSize() {
    const entries = await this.entries();
    let total = 0;
    for (const [k, v] of entries) {
      total += new Blob([k]).size;
      try { total += new Blob([JSON.stringify(v)]).size; } catch { /* */ }
    }
    return total;
  }
}

// 测试用：重置内部缓存的 db connection（jsdom 切换 store schema 时需要）
export function _resetCache() {
  if (_dbPromise) {
    _dbPromise.then(db => db && db.close()).catch(() => {});
  }
  _dbPromise = null;
}
