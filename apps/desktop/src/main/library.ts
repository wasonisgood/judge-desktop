// 檔案管理：保存每次的判決列表、範圍整理表與精讀結果，可封存、移入垃圾桶、加星號。
// 資料只存在使用者電腦（userData/library.json）。垃圾桶中的項目可以還原，或永久刪除。
import * as fs from 'node:fs/promises';

export type LibraryKind = 'list' | 'scope' | 'brief';
export type LibraryStatus = 'active' | 'archived' | 'trashed';

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  title: string;
  /** 一行摘要（例如筆數、日期），顯示在列表中。 */
  summary: string;
  createdAt: string;
  status: LibraryStatus;
  starred: boolean;
  /** 完整結果，供之後再次開啟。 */
  payload: unknown;
}

export interface LibraryPatch {
  status?: LibraryStatus;
  starred?: boolean;
}

export function newId(now: Date = new Date()): string {
  return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 新增一筆（不做 I/O）。 */
export function addItem(items: LibraryItem[], input: Omit<LibraryItem, 'id' | 'createdAt' | 'status' | 'starred'>, now: Date = new Date()): LibraryItem[] {
  const item: LibraryItem = { ...input, id: newId(now), createdAt: now.toISOString(), status: 'active', starred: false };
  return [item, ...items];
}

/** 更新狀態或星號（不做 I/O）。找不到 id 時原樣回傳。 */
export function updateItem(items: LibraryItem[], id: string, patch: LibraryPatch): LibraryItem[] {
  return items.map((it) => (it.id === id ? { ...it, ...patch } : it));
}

/** 只有已在垃圾桶中的項目可以永久刪除（不做 I/O）。 */
export function removeTrashed(items: LibraryItem[], id: string): { items: LibraryItem[]; removed: boolean } {
  const target = items.find((it) => it.id === id);
  if (!target || target.status !== 'trashed') return { items, removed: false };
  return { items: items.filter((it) => it.id !== id), removed: true };
}

/** 依狀態篩選；未指定狀態時回傳全部。星號項目排在前面。 */
export function listItems(items: LibraryItem[], status?: LibraryStatus): LibraryItem[] {
  const filtered = status ? items.filter((it) => it.status === status) : items;
  return [...filtered].sort((a, b) => Number(b.starred) - Number(a.starred) || b.createdAt.localeCompare(a.createdAt));
}

/** 檔案式的儲存（讀寫 JSON）。 */
export class LibraryStore {
  private items: LibraryItem[] = [];
  private loaded = false;

  constructor(private readonly file: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.items = JSON.parse(await fs.readFile(this.file, 'utf8')) as LibraryItem[];
    } catch {
      this.items = [];
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fs.mkdir(this.file.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.items), 'utf8');
  }

  async add(input: Omit<LibraryItem, 'id' | 'createdAt' | 'status' | 'starred'>): Promise<LibraryItem> {
    await this.load();
    this.items = addItem(this.items, input);
    await this.save();
    return this.items[0];
  }

  async list(status?: LibraryStatus): Promise<LibraryItem[]> {
    await this.load();
    return listItems(this.items, status);
  }

  async update(id: string, patch: LibraryPatch): Promise<void> {
    await this.load();
    this.items = updateItem(this.items, id, patch);
    await this.save();
  }

  async removePermanently(id: string): Promise<boolean> {
    await this.load();
    const r = removeTrashed(this.items, id);
    this.items = r.items;
    if (r.removed) await this.save();
    return r.removed;
  }
}
