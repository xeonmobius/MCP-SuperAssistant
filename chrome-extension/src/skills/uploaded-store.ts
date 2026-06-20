import type { UploadedSkill } from './uploaded-parser';

const STORAGE_KEY = 'uploadedSkills';
const DB_NAME = 'mcp-skills';
const DB_VERSION = 1;
const STORE_REFS = 'references';

export interface StoreDeps {
  storage: {
    get: (k: string) => Promise<Record<string, any>>;
    set: (i: Record<string, any>) => Promise<void>;
  };
  idbFactory: IDBFactory;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_REFS)) {
        const os = db.createObjectStore(STORE_REFS, { keyPath: 'key' });
        os.createIndex('skillName', 'skillName', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function deleteBySkillName(store: IDBObjectStore, skillName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const idx = store.index('skillName');
    const req = idx.openCursor(IDBKeyRange.only(skillName));
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        store.delete((c.value as any).key);
        c.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export function createUploadedStore(deps: StoreDeps) {
  const { storage, idbFactory } = deps;

  const listUploadedSkills = async (): Promise<UploadedSkill[]> => {
    const r = await storage.get(STORAGE_KEY);
    return (r[STORAGE_KEY] as UploadedSkill[]) || [];
  };

  const getUploadedSkill = async (name: string): Promise<UploadedSkill | undefined> =>
    (await listUploadedSkills()).find(s => s.name === name);

  const saveUploadedSkill = async (
    skill: UploadedSkill,
    references: Map<string, string>,
  ): Promise<void> => {
    const all = (await listUploadedSkills()).filter(s => s.name !== skill.name);
    all.push(skill);
    await storage.set({ [STORAGE_KEY]: all });

    const db = await openDb(idbFactory);
    try {
      const tx = db.transaction(STORE_REFS, 'readwrite');
      const store = tx.objectStore(STORE_REFS);
      await deleteBySkillName(store, skill.name);
      for (const [path, text] of references) {
        store.put({
          key: `${skill.name}::${path}`,
          skillName: skill.name,
          path,
          text,
          size: text.length,
          uploadedAt: skill.uploadedAt,
        });
      }
      await txDone(tx);
    } finally {
      db.close();
    }
  };

  const deleteUploadedSkill = async (name: string): Promise<void> => {
    const all = (await listUploadedSkills()).filter(s => s.name !== name);
    await storage.set({ [STORAGE_KEY]: all });

    const db = await openDb(idbFactory);
    try {
      const tx = db.transaction(STORE_REFS, 'readwrite');
      await deleteBySkillName(tx.objectStore(STORE_REFS), name);
      await txDone(tx);
    } finally {
      db.close();
    }
  };

  const readReference = async (
    skillName: string,
    path: string,
  ): Promise<string | undefined> => {
    const db = await openDb(idbFactory);
    try {
      const tx = db.transaction(STORE_REFS, 'readonly');
      const store = tx.objectStore(STORE_REFS);
      return await new Promise<string | undefined>((resolve, reject) => {
        const req = store.get(`${skillName}::${path}`);
        req.onsuccess = () =>
          resolve(req.result ? (req.result as any).text : undefined);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };

  return {
    listUploadedSkills,
    getUploadedSkill,
    saveUploadedSkill,
    deleteUploadedSkill,
    readReference,
  };
}

// Default background-side instance uses real chrome.storage + indexedDB.
// Guarded so module import doesn't crash in non-chrome runtimes (tests).
export const uploadedStore: ReturnType<typeof createUploadedStore> =
  typeof chrome !== 'undefined' && typeof indexedDB !== 'undefined'
    ? createUploadedStore({ storage: chrome.storage.local, idbFactory: indexedDB })
    : (undefined as unknown as ReturnType<typeof createUploadedStore>);
