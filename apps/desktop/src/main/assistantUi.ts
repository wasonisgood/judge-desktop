// 助理的畫面操作（純函式，不依賴 Electron）：控制項目錄的清理、敏感欄位隱藏、設值檢查、提供給模型的文字目錄。
// 原則：
// 1. 模型只能操作目錄中存在的控制項（以 id 比對）；沒有列出的 id 一律拒絕。
// 2. 密碼、金鑰、權杖等敏感欄位只讓模型知道 id 與標籤，看不到值，也不能填寫。
// 3. 按鈕一律由使用者確認後才按下（見 assistant.ts 的 ui_click 待確認流程）。
export type UiKind = 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'button';

export interface UiControl {
  id: string;
  /** 所在頁面（頁面 id 去掉 page- 前綴，例如 list、settings）。 */
  page: string;
  kind: UiKind;
  label: string;
  value?: string | number | boolean;
  options?: string[];
  disabled?: boolean;
  secret?: boolean;
}

/** 助理回傳給畫面、立即執行（不需確認）的動作。 */
export type UiAction =
  | { type: 'set'; id: string; value: string | number | boolean }
  | { type: 'openSaved'; id: string };

const ID_RE = /^[A-Za-z][\w-]{0,79}$/;
const KINDS: UiKind[] = ['text', 'number', 'select', 'checkbox', 'textarea', 'button'];
// 敏感欄位：明確的金鑰、權杖、密碼字樣，以及設定頁的 setKey／keyField（不可用單純的 key，否則 listKeyword 會被誤判）。
export const SECRET_RE = /secret|token|passw|apikey|api[-_]?key|credential|金鑰|密碼|權杖|^setkey$|^keyfield$/i;
const MAX_CONTROLS = 400;
const MAX_PROMPT_CHARS = 14000;

/** 檔案頁可由助理執行的動作（delete 為永久刪除）。 */
export type SavedAction = 'star' | 'unstar' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'delete';

export const SAVED_ACTIONS: Record<SavedAction, string> = {
  star: '加星號',
  unstar: '取消星號',
  archive: '封存',
  unarchive: '移回使用中',
  trash: '移入垃圾桶',
  restore: '還原',
  delete: '永久刪除（無法復原）',
};

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** 清理畫面送來的控制項目錄：驗證 id 與類型、隱藏敏感值、限制數量與長度。 */
export function sanitizeControls(raw: unknown): UiControl[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: UiControl[] = [];
  for (const item of raw.slice(0, MAX_CONTROLS)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const id = str(c.id, 80);
    const kind = KINDS.includes(c.kind as UiKind) ? (c.kind as UiKind) : null;
    const page = str(c.page, 40);
    if (!ID_RE.test(id) || !kind || !page || seen.has(id)) continue;
    seen.add(id);
    const label = str(c.label, 60).trim() || id;
    const secret = SECRET_RE.test(id) || SECRET_RE.test(label) || c.secret === true;
    const control: UiControl = { id, page, kind, label, secret };
    if (c.disabled === true) control.disabled = true;
    if (kind !== 'button' && !secret) {
      if (typeof c.value === 'string') control.value = c.value.slice(0, 80);
      else if (typeof c.value === 'number' || typeof c.value === 'boolean') control.value = c.value;
    }
    if (kind === 'select' && Array.isArray(c.options)) {
      control.options = c.options.slice(0, 30).map((o) => str(o, 40)).filter(Boolean);
    }
    out.push(control);
  }
  return out;
}

export function controlMap(controls: UiControl[]): Map<string, UiControl> {
  return new Map(controls.map((c) => [c.id, c]));
}

/** 檢查要寫入控制項的值；回傳可寫入的值，或拒絕的原因（會回給模型）。 */
export function checkSetValue(c: UiControl, value: unknown): { ok: true; value: string | number | boolean } | { ok: false; reason: string } {
  if (c.secret) return { ok: false, reason: `「${c.label}」是敏感欄位，助理不能填寫，請使用者自行輸入。` };
  if (c.kind === 'button') return { ok: false, reason: `「${c.label}」是按鈕，請用按下按鈕的操作，而不是設定值。` };
  if (c.disabled) return { ok: false, reason: `「${c.label}」目前是停用狀態。` };
  if (c.kind === 'checkbox') {
    if (typeof value === 'boolean') return { ok: true, value };
    if (value === 'true' || value === 'false') return { ok: true, value: value === 'true' };
    return { ok: false, reason: `「${c.label}」是勾選框，值必須是 true 或 false。` };
  }
  if (c.kind === 'number') {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isFinite(n)) return { ok: false, reason: `「${c.label}」必須是數字。` };
    return { ok: true, value: n };
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return { ok: false, reason: `「${c.label}」的值格式不正確。` };
  }
  const text = String(value);
  if (c.kind === 'select' && c.options && c.options.length && !c.options.includes(text)) {
    return { ok: false, reason: `「${c.label}」沒有「${text}」這個選項，可選：${c.options.join('、')}。` };
  }
  return { ok: true, value: text.slice(0, 2000) };
}

/** 提供給模型的目錄文字：目前頁面完整列出（含目前值與選項），其他頁面只列 id 與標籤。 */
export function controlsPrompt(controls: UiControl[], currentPage: string): string {
  const lines: string[] = [];
  const here = controls.filter((c) => c.page === currentPage);
  lines.push(`目前頁面：${currentPage}`);
  for (const c of here) {
    const parts = [`${c.id}（${c.kind}，${c.label}`];
    if (c.secret) parts.push('敏感，不可填寫');
    else if (c.value !== undefined && c.kind !== 'button') parts.push(`目前值：${JSON.stringify(c.value)}`);
    if (c.options) parts.push(`選項：${c.options.join('|')}`);
    if (c.disabled) parts.push('停用');
    lines.push('- ' + parts.join('，') + '）');
  }
  const others = new Map<string, string[]>();
  for (const c of controls) {
    if (c.page === currentPage) continue;
    const list = others.get(c.page) ?? [];
    list.push(`${c.id}（${c.label}）`);
    others.set(c.page, list);
  }
  const otherLines: string[] = [];
  others.forEach((list, page) => otherLines.push(`${page}：${list.join('、')}`));
  let text = lines.join('\n') + (otherLines.length ? '\n其他頁面控制項（需要時先用 open_page 切換，或直接用 id 操作）：\n' + otherLines.join('\n') : '');
  if (text.length > MAX_PROMPT_CHARS) text = text.slice(0, MAX_PROMPT_CHARS) + '\n（目錄過長已截斷）';
  return text;
}
