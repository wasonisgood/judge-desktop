// 研究設計引導（issue #11）：由模糊的問題意識，逐步凝練為可用判決實證的研究題目。
// 原則（issue 指定）：
// - 每一步的建議都附理由（研究方法語言），並說明代價（樣本量、選擇偏誤）。
// - 建議都是選項：只有研究者明確接受（applySuggestion）才會改變條件；本模組不會自動改動篩選條件。
// - 可實證性檢查：能否由判決原文回答；不能的要明說。
// - 摘要可帶入範圍整理流程（summaryToScopeOptions），並可匯出文字。
// 純函式、可直接測試；AI 只用於把使用者的自然語言回答整理成欄位（由呼叫端決定是否使用）。

export interface DesignSlots {
  /** 原始的問題意識（使用者的原話）。 */
  problem: string;
  /** 可實證的研究問題（一句話，含研究對象與比較或觀察的對象）。 */
  question?: string;
  /** 研究對象（例如「消費者保護訴訟的原告」）。 */
  subject?: string;
  /** 要比較或觀察的變項（例如「是否有律師代理」「判決結果」）。 */
  variable?: string;
  /** 期間（西元年，起迄含）。 */
  yearFrom?: number;
  yearTo?: number;
  /** 法規（引用的條文或法律名稱）；用於範圍整理。 */
  statute?: string;
  /** 案件類型（民事、刑事、行政等）；範圍整理不支援自動篩選，需人工於列表篩選。 */
  caseType?: string;
  /** 法院層級（地方、高等、最高）；同上。 */
  courtLevel?: string;
}

export type SlotKey = Exclude<keyof DesignSlots, 'problem' | 'yearTo'>;
export type TextSlotKey = Exclude<SlotKey, 'yearFrom'>;

/** 追問順序：先確定題目，再確定對象、變項、期間，最後是法規與其他篩選。 */
export const SLOT_ORDER: SlotKey[] = ['question', 'subject', 'variable', 'yearFrom', 'statute', 'caseType', 'courtLevel'];

const PROMPTS: Record<SlotKey, { ask: string; why: string }> = {
  question: {
    ask: '你最想回答的問題是什麼？請用一句話描述，例如「消費者訴訟中，原告有律師代理是否較容易勝訴？」',
    why: '研究問題決定之後所有的篩選與分析方式；沒有明確問題，任何範圍都只是「撈資料」。',
  },
  subject: {
    ask: '這個問題的研究對象是誰或哪一類案件？例如「原告為消費者的民事訴訟」。',
    why: '研究對象決定母體（population）。母體定義得越清楚，之後的樣本才能說明它代表什麼。',
  },
  variable: {
    ask: '你打算比較或觀察哪一個變項？例如「是否有律師代理」「判決結果」「賠償金額級距」。',
    why: '變項決定需要從判決原文中操作化（operationalize）的資訊。只有能在原文中找到的變項，才能實證。',
  },
  yearFrom: {
    ask: '想觀察的期間是哪幾年（西元）？例如 2018 至 2023。',
    why: '期間決定樣本量與時間趨勢的可比性。期間太短樣本可能不足；太長則法規可能已修正，需注意版本差異。',
  },
  statute: {
    ask: '研究是否針對特定法規或條文？若有，請寫出法規名稱或條號（例如「消費者保護法」）。',
    why: '以法規為範圍，可以用引用關係建立樣本，這是範圍整理表的基本做法；但只看引用的案件會有選擇偏誤。',
  },
  caseType: {
    ask: '案件類型是民事、刑事還是行政？',
    why: '案件類型決定適用的程序與判決書結構，也影響變項能否在原文中找到。',
  },
  courtLevel: {
    ask: '只看地方法院、高等法院，還是全部審級？',
    why: '審級不同，判決的性質與樣本來源不同（例如上訴審多為程序駁回）；限定審級會減少樣本，但可避免混合不同性質的裁判。',
  },
};

export const SLOT_LABEL: Record<SlotKey, string> = {
  question: '研究問題',
  subject: '研究對象',
  variable: '變項',
  yearFrom: '期間',
  statute: '法規',
  caseType: '案件類型',
  courtLevel: '法院層級',
};

export interface GuideStep {
  slot: SlotKey;
  prompt: string;
  rationale: string;
}

/** 下一個要追問的欄位；全部齊備時回傳 null。 */
export function nextStep(slots: DesignSlots): GuideStep | null {
  const slot = SLOT_ORDER.find((k) => isMissing(slots[k]));
  if (!slot) return null;
  return { slot, prompt: PROMPTS[slot].ask, rationale: PROMPTS[slot].why };
}

function isMissing(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

export interface NarrowingSuggestion {
  id: string;
  /** 縮小的維度。 */
  dimension: 'period' | 'court' | 'caseType' | 'statute';
  /** 建議內容（給研究者看）。 */
  text: string;
  /** 為什麼這樣做（研究方法語言）。 */
  rationale: string;
  /** 代價：樣本量下降、選擇偏誤等。 */
  tradeoff: string;
  /** 套用後會改動的欄位（只有研究者接受後才會寫入）。 */
  patch: Partial<DesignSlots>;
}

/**
 * 範圍縮小的建議：一次只建議縮小一個維度，並說明理由與代價。
 * 只回傳建議，不改動任何欄位。
 */
export function suggestNarrowing(slots: DesignSlots): NarrowingSuggestion[] {
  const out: NarrowingSuggestion[] = [];
  if (slots.yearFrom && slots.yearTo && slots.yearTo - slots.yearFrom + 1 > 5) {
    const mid = Math.floor((slots.yearFrom + slots.yearTo) / 2);
    out.push({
      id: 'period-recent',
      dimension: 'period',
      text: `把期間縮為 ${mid + 1} 至 ${slots.yearTo} 年`,
      rationale: '期間過長時，法規可能已修正、實務見解已改變，前後案件不可直接比較；縮小到近期可提高可比性。',
      tradeoff: '樣本量會下降，且只代表近期的實務，不代表整體期間。',
      patch: { yearFrom: mid + 1 },
    });
  }
  if (slots.statute && !slots.caseType) {
    out.push({
      id: 'case-type',
      dimension: 'caseType',
      text: '限定為民事或刑事其中一類',
      rationale: '同一法規可能同時出現在民事與刑事案件中，性質不同的判決混在一起，會稀釋變項的效果。',
      tradeoff: '樣本會減少；且需人工在列表中篩選（範圍整理表不會自動篩）。',
      patch: {},
    });
  }
  if (!slots.courtLevel) {
    out.push({
      id: 'court-level',
      dimension: 'court',
      text: '先只看地方法院的第一審判決',
      rationale: '第一審最能反映事實認定與初步判斷；上訴審多為程序駁回或改判，混入會影響結果變項的解讀。',
      tradeoff: '會排除上訴審的資訊，若研究問題是上訴審的見解，這個建議不適用。',
      patch: { courtLevel: '地方法院' },
    });
  }
  return out;
}

export interface FeasibilityCheck {
  key: 'question' | 'subject' | 'variable' | 'period' | 'statute' | 'textAvailability' | 'selectionBias';
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

/** 可實證性檢查：題目能否由判決原文回答。不能的要明說（status 為 fail）。 */
export function feasibilityChecks(slots: DesignSlots, now: Date = new Date()): FeasibilityCheck[] {
  const checks: FeasibilityCheck[] = [];
  const q = slots.question?.trim() ?? '';
  checks.push(q
    ? { key: 'question', status: q.length >= 6 ? 'ok' : 'warn', message: q.length >= 6 ? '已有研究問題' : '研究問題太短，建議寫成完整的問句' }
    : { key: 'question', status: 'fail', message: '尚未有研究問題' });
  checks.push(slots.subject?.trim()
    ? { key: 'subject', status: 'ok', message: '研究對象已定義' }
    : { key: 'subject', status: 'fail', message: '尚未定義研究對象（母體）' });
  if (!slots.variable?.trim()) {
    checks.push({ key: 'variable', status: 'fail', message: '尚未定義變項' });
  } else {
    // 變項若是判決中不會寫的內容（例如「被告的收入」），判決原文很難找到；這裡只做提醒。
    checks.push({ key: 'variable', status: 'ok', message: '變項需能在判決原文中找到，請確認（例如判決主文、理由段落）' });
  }
  const year = now.getFullYear();
  if (slots.yearFrom === undefined || slots.yearTo === undefined) {
    checks.push({ key: 'period', status: 'fail', message: '尚未設定期間' });
  } else if (slots.yearFrom > slots.yearTo) {
    checks.push({ key: 'period', status: 'fail', message: '期間起始年晚於結束年' });
  } else if (slots.yearTo > year) {
    checks.push({ key: 'period', status: 'fail', message: `期間結束年（${slots.yearTo}）晚於今年（${year}），尚無判決書` });
  } else if (slots.yearTo - slots.yearFrom + 1 < 2) {
    checks.push({ key: 'period', status: 'warn', message: '期間只有一年，樣本量可能不足，且無法觀察趨勢' });
  } else {
    checks.push({ key: 'period', status: 'ok', message: `期間 ${slots.yearFrom}–${slots.yearTo} 年` });
  }
  checks.push(slots.statute?.trim()
    ? { key: 'statute', status: 'ok', message: `以法規「${slots.statute.trim()}」建立樣本（引用關係）` }
    : { key: 'statute', status: 'warn', message: '未指定法規：樣本需以關鍵字搜尋，搜尋結果的相關性需逐案確認' });
  checks.push({
    key: 'textAvailability',
    status: 'ok',
    message: '判決原文可由司法院取得；樣本數需等實際搜尋後才能確定（本步驟不會預先計數）',
  });
  const narrowed = Boolean(slots.courtLevel || slots.caseType || slots.statute);
  checks.push(narrowed
    ? { key: 'selectionBias', status: 'warn', message: '已限定條件：結果只代表符合這些條件的判決，推論到整體時需說明選擇偏誤' }
    : { key: 'selectionBias', status: 'ok', message: '未限定條件，樣本範圍較廣' });
  return checks;
}

/** 研究者接受某項建議後，才把 patch 寫入欄位（回傳新物件，不改原物件）。 */
export function applySuggestion(slots: DesignSlots, s: NarrowingSuggestion): DesignSlots {
  return { ...slots, ...s.patch };
}

export interface DesignTurn {
  role: 'user' | 'guide';
  text: string;
  /** 助理的建議附上理由（只有 guide 回合才有）。 */
  rationale?: string;
  at: string;
}

export interface DesignSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  slots: DesignSlots;
  turns: DesignTurn[];
  /** 研究者接受過的建議（留存以便回溯）。 */
  accepted: { id: string; text: string; at: string }[];
}

export function newSession(problem: string, now: Date = new Date()): DesignSession {
  const stamp = now.toISOString();
  return {
    id: `design-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: stamp,
    updatedAt: stamp,
    slots: { problem: problem.trim() },
    turns: [{ role: 'user', text: problem.trim(), at: stamp }],
    accepted: [],
  };
}

/** 把使用者的回答寫入指定欄位（只接受已知欄位；期間以年份解析）。 */
export function answerSlot(session: DesignSession, slot: SlotKey, answer: string, now: Date = new Date()): DesignSession {
  const text = answer.trim();
  const slots: DesignSlots = { ...session.slots };
  if (slot === 'yearFrom') {
    const years = (text.match(/\d{4}/g) ?? []).map(Number).filter((y) => y >= 1900 && y <= 2200);
    if (!years.length) throw new Error('請輸入西元年，例如 2018 至 2023');
    slots.yearFrom = years[0];
    slots.yearTo = years[1] ?? years[0];
  } else {
    slots[slot as TextSlotKey] = text;
  }
  const stamp = now.toISOString();
  return {
    ...session,
    slots,
    updatedAt: stamp,
    turns: [...session.turns, { role: 'user', text, at: stamp }],
  };
}

/** 記錄助理的一回合（附理由）。 */
export function addGuideTurn(session: DesignSession, text: string, rationale: string, now: Date = new Date()): DesignSession {
  const stamp = now.toISOString();
  return { ...session, updatedAt: stamp, turns: [...session.turns, { role: 'guide', text, rationale, at: stamp }] };
}

/** 接受建議：套用 patch，並記錄在 accepted。 */
export function acceptSuggestion(session: DesignSession, s: NarrowingSuggestion, now: Date = new Date()): DesignSession {
  const stamp = now.toISOString();
  return {
    ...session,
    slots: applySuggestion(session.slots, s),
    updatedAt: stamp,
    accepted: [...session.accepted, { id: s.id, text: s.text, at: stamp }],
    turns: [...session.turns, { role: 'user', text: `接受建議：${s.text}`, at: stamp }],
  };
}

export interface DesignSummary {
  researchQuestion: string;
  subject: string;
  variable: string;
  period: string;
  statute: string;
  /** 需要人工在列表中篩選的條件（範圍整理表不支援自動篩選）。 */
  manualFilters: string[];
  analysisPlan: string[];
  limitations: string[];
  /** 每一步的理由（依對話順序）。 */
  rationales: string[];
  acceptedSuggestions: string[];
}

/** 產生研究設計摘要。資料不足時仍會產生，但會在 limitations 中寫明缺漏。 */
export function buildDesignSummary(session: DesignSession): DesignSummary {
  const s = session.slots;
  const missing = SLOT_ORDER.filter((k) => isMissing(s[k]));
  const period = s.yearFrom && s.yearTo ? `${s.yearFrom}–${s.yearTo} 年` : '未設定';
  const manualFilters = [s.caseType ? `案件類型：${s.caseType}` : '', s.courtLevel ? `法院層級：${s.courtLevel}` : ''].filter(Boolean);
  const plan = [
    s.variable ? `以「${s.variable}」為主要變項，逐案從判決原文編碼` : '尚未定義分析變項',
    '先計算描述統計（次數與比例），再依研究問題決定是否需要檢定',
    '每個編碼結果都保留判決原文的依據段落，以便人工覆核',
  ];
  const limitations = [
    ...missing.map((k) => `尚未決定：${SLOT_LABEL[k]}`),
    '判決書只記載法院認定的事實，無法反映未進入訴訟的案件（選擇偏誤）',
    ...(manualFilters.length ? ['部分條件需人工篩選，結果數可能與自動搜尋不同'] : []),
  ];
  return {
    researchQuestion: s.question ?? '（尚未定義）',
    subject: s.subject ?? '（尚未定義）',
    variable: s.variable ?? '（尚未定義）',
    period,
    statute: s.statute ?? '（未指定，以關鍵字搜尋）',
    manualFilters,
    analysisPlan: plan,
    limitations,
    rationales: session.turns.filter((t) => t.role === 'guide' && t.rationale).map((t) => `${t.text}：${t.rationale}`),
    acceptedSuggestions: session.accepted.map((a) => a.text),
  };
}

/** 摘要轉為範圍整理的參數（只帶入可自動套用的條件；其餘列在 manualFilters）。 */
export function summaryToScopeOptions(slots: DesignSlots): { statute: string; yearFrom?: number; yearTo?: number; searchQuery?: string } | null {
  if (!slots.statute?.trim()) return null;
  return {
    statute: slots.statute.trim(),
    yearFrom: slots.yearFrom,
    yearTo: slots.yearTo,
    searchQuery: slots.question?.trim() || undefined,
  };
}

/** 摘要的純文字版（可匯出為 Word 或貼到報告中）。 */
export function designSummaryText(sum: DesignSummary): string {
  const lines = [
    '研究設計摘要',
    `研究問題：${sum.researchQuestion}`,
    `研究對象：${sum.subject}`,
    `變項：${sum.variable}`,
    `期間：${sum.period}`,
    `法規：${sum.statute}`,
  ];
  if (sum.manualFilters.length) lines.push(`需人工篩選：${sum.manualFilters.join('；')}`);
  lines.push('分析方式：', ...sum.analysisPlan.map((p) => `- ${p}`));
  lines.push('限制：', ...sum.limitations.map((p) => `- ${p}`));
  if (sum.rationales.length) lines.push('各步驟理由：', ...sum.rationales.map((p) => `- ${p}`));
  if (sum.acceptedSuggestions.length) lines.push('已接受的建議：', ...sum.acceptedSuggestions.map((p) => `- ${p}`));
  return lines.join('\n');
}
