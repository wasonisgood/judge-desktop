// 手動輸入判決：把使用者貼上的多行文字解析為判決 ID（純函式，不做網路 I/O）。
// 每行可以是司法院判決頁網址（含 id= 參數），或直接是判決 ID（例如 TPSV_103_2434_20141119）。
export interface ManualIdParse {
  /** 去除重複後的判決 ID，保留輸入順序。 */
  ids: string[];
  /** 無法辨識的行（原文）。 */
  invalid: string[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-.]{2,120}$/;

export function parseManualJudgmentIds(text: string): ManualIdParse {
  const ids: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let id: string | null = null;
    const m = /[?&]id=([^&\s#]+)/.exec(line);
    if (m) {
      try { id = decodeURIComponent(m[1]); } catch { id = null; }
    } else if (ID_PATTERN.test(line)) {
      id = line;
    }
    if (!id || !ID_PATTERN.test(id)) {
      invalid.push(line);
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, invalid };
}
