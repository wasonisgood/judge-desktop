// 段落切分（issue #10）：把判決原文切成「犯罪事實／法律事實」與「法官見解（理由）」兩類段落。
// 純函式。切分是啟發式的：事實及理由合併的判決，以第一個明顯屬於理由論述的段落作為分界；無法判斷時歸為事實，並由呼叫端保留原文可回溯。
export type PassageKind = 'fact' | 'opinion';

export interface Passage {
  /** 形如 `<caseId>#<序號>`，同一案件內唯一。 */
  id: string;
  caseId: string;
  kind: PassageKind;
  /** 來源區段名稱（例如「事實及理由」「理由」）。 */
  section: string;
  text: string;
}

const MIN_LEN = 8;

/** 依空行與換行切段；過長的段落依句號再切（不超過 maxLen 字）；過短的段落併入前一段。 */
export function splitParagraphs(text: string, maxLen = 400): string[] {
  const raw = text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const p of raw) {
    if (p.length <= maxLen) {
      pieces.push(p);
      continue;
    }
    // 依句號切，再貪婪地組合成不超過 maxLen 的段落。
    const sentences = p.split(/(?<=[。；])/).filter(Boolean);
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length > maxLen && buf) {
        pieces.push(buf.trim());
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf.trim()) pieces.push(buf.trim());
  }
  const out: string[] = [];
  for (const p of pieces) {
    if (p.length < MIN_LEN && out.length) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

/** 理由論述的常見起頭（用於「事實及理由」合併區段的分界）。 */
const OPINION_START = /^(理由|本院|按|經查|查|爰|茲|因|依|核|基此|是|綜上)/;

/** 由判決區段（splitSections 的結果）切出段落。主文不納入（既非事實也非見解）。 */
export function splitPassages(caseId: string, sections: Record<string, string>): Passage[] {
  const out: Passage[] = [];
  const push = (kind: PassageKind, section: string, text: string) => {
    for (const t of splitParagraphs(text)) {
      out.push({ id: `${caseId}#${out.length + 1}`, caseId, kind, section, text: t });
    }
  };
  for (const [name, body] of Object.entries(sections)) {
    if (!body || name === '主文' || name === '前置') continue;
    if (name === '事實及理由') {
      const paras = splitParagraphs(body);
      const cut = paras.findIndex((p, i) => i > 0 && OPINION_START.test(p));
      const facts = cut < 0 ? paras : paras.slice(0, cut);
      const opinions = cut < 0 ? [] : paras.slice(cut);
      if (facts.length) push('fact', name, facts.join('\n'));
      if (opinions.length) push('opinion', name, opinions.join('\n'));
      continue;
    }
    if (/事實/.test(name)) push('fact', name, body);
    else push('opinion', name, body);
  }
  return out;
}

/** 依段落類型篩選（事實模式或見解模式）。 */
export function passagesOfKind(passages: Passage[], kind: PassageKind): Passage[] {
  return passages.filter((p) => p.kind === kind);
}
