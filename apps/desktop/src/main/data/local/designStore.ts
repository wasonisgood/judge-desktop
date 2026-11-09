// 本地資料層：研究設計引導的對話紀錄（design-sessions.json）。與檔案管理（library.json）分開保存。
import { readJson, writeJson } from './jsonFile';
import { userPath } from './paths';
import type { StoredDesign } from '../../designSession';

interface DesignFile {
  items: StoredDesign[];
}

const file = () => userPath('design-sessions.json');

// 寫入一律排隊，避免同時的 IPC 呼叫互相覆蓋。
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function readAll(): Promise<StoredDesign[]> {
  const data = await readJson<DesignFile>(file(), { items: [] });
  return Array.isArray(data.items) ? data.items : [];
}

export async function listDesigns(): Promise<StoredDesign[]> {
  return readAll();
}

export async function getDesign(id: string): Promise<StoredDesign | null> {
  return (await readAll()).find((d) => d.session.id === id) ?? null;
}

export function putDesign(entry: StoredDesign): Promise<void> {
  return serial(async () => {
    const items = await readAll();
    const i = items.findIndex((d) => d.session.id === entry.session.id);
    if (i >= 0) items[i] = entry;
    else items.unshift(entry);
    await writeJson(file(), { items });
  });
}

export function removeDesign(id: string): Promise<boolean> {
  return serial(async () => {
    const items = await readAll();
    const next = items.filter((d) => d.session.id !== id);
    if (next.length === items.length) return false;
    await writeJson(file(), { items: next });
    return true;
  });
}
