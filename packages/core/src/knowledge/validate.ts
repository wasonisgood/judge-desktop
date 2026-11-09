// 爭點知識庫：結構驗證（純函式）。
// 驗證失敗的爭點會被略過並記錄原因，不會讓整個知識庫無法載入。
import { KNOWLEDGE_SCHEMA_VERSION, type Issue, type KnowledgeFile, type IndexedIssue } from './types';

export interface ValidationProblem {
  /** 來源檔案的識別（由呼叫端提供，例如檔名）。 */
  source: string;
  /** 爭點 id；檔案層級問題為 null。 */
  issueId: string | null;
  message: string;
}

export interface ValidatedFile {
  file: KnowledgeFile | null;
  issues: IndexedIssue[];
  problems: ValidationProblem[];
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isNonEmptyString);

/** 驗證單一爭點的欄位；回傳問題清單（空陣列代表通過）。 */
export function validateIssue(raw: unknown): string[] {
  const p: string[] = [];
  if (typeof raw !== 'object' || raw === null) return ['爭點不是物件'];
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) p.push('缺少 id');
  if (!isNonEmptyString(o.title)) p.push('缺少 title');
  if (!isStringArray(o.path) || o.path.length === 0) p.push('path 必須是非空字串陣列');
  if (!isStringArray(o.keywords) || o.keywords.length === 0) p.push('keywords 必須是非空字串陣列');
  if (!isNonEmptyString(o.proposition)) p.push('缺少爭點核心描述 proposition');
  if (!isNonEmptyString(o.distinction)) p.push('缺少爭點區分實益 distinction');
  if (!Array.isArray(o.doctrines) || o.doctrines.length < 2) {
    p.push('學說見解 doctrines 至少需要兩說');
  } else {
    o.doctrines.forEach((d, i) => {
      const x = d as Record<string, unknown>;
      if (!x || !isNonEmptyString(x.label) || !isNonEmptyString(x.view)) p.push(`doctrines[${i}] 缺少 label 或 view`);
    });
  }
  if (!Array.isArray(o.practice) || o.practice.length === 0) {
    p.push('實務見解 practice 至少需要一項');
  } else {
    o.practice.forEach((d, i) => {
      const x = d as Record<string, unknown>;
      if (!x || !isNonEmptyString(x.view)) p.push(`practice[${i}] 缺少 view`);
    });
  }
  if (!isStringArray(o.lawRefs)) p.push('lawRefs 必須是字串陣列（可為空時仍須是陣列）');
  if (!isNonEmptyString(o.reviewStatus)) p.push('缺少 reviewStatus');
  return p;
}

/** 驗證整個檔案，逐筆爭點驗證；重複的 id 只保留第一筆。 */
export function validateKnowledgeFile(raw: unknown, source: string): ValidatedFile {
  const problems: ValidationProblem[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { file: null, issues: [], problems: [{ source, issueId: null, message: '檔案不是物件' }] };
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== KNOWLEDGE_SCHEMA_VERSION) {
    problems.push({ source, issueId: null, message: `schemaVersion 必須為 ${KNOWLEDGE_SCHEMA_VERSION}` });
    return { file: null, issues: [], problems };
  }
  if (!isNonEmptyString(o.jurisdiction) || !isNonEmptyString(o.domain) || !Array.isArray(o.issues)) {
    problems.push({ source, issueId: null, message: '缺少 jurisdiction、domain 或 issues' });
    return { file: null, issues: [], problems };
  }
  const seen = new Set<string>();
  const issues: IndexedIssue[] = [];
  for (const item of o.issues) {
    const idRaw = (item as { id?: unknown })?.id;
    const id = typeof idRaw === 'string' ? idRaw : null;
    const errs = validateIssue(item);
    if (id !== null && seen.has(id)) errs.push('id 重複');
    if (errs.length) {
      for (const message of errs) problems.push({ source, issueId: id, message });
      continue;
    }
    seen.add(id as string);
    const issue = item as Issue;
    issues.push({ ...issue, jurisdiction: o.jurisdiction as string, domain: o.domain as string });
  }
  const file: KnowledgeFile = {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    jurisdiction: o.jurisdiction as string,
    domain: o.domain as string,
    issues: issues.map(({ jurisdiction: _j, domain: _d, ...rest }) => rest),
  };
  return { file, issues, problems };
}
