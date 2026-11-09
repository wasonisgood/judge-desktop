// 標編碼工序的信心與人工覆核規則測試：規則邊界、門檻設定、覆核操作（接受、修改、駁回、批次、還原）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REVIEW_POLICY, normalizeReviewPolicy, decideReview, isHighConfidence, reviewValue, undoReview,
  applyReviewOp, summarizeReview, verifyCodedValue, formatCodedCell,
} from '../../dist/index.js';

const TEXT = '原告主張被告行為構成侵權行為，依國家賠償法第二條第二項請求賠償。法院認為該請求應予駁回，理由如下。';
const field = (id, name) => ({ id, name });
const AT = '2026-11-10T00:00:00.000Z';

test('預設門檻：至少 1 則有效依據、不允許任何無效依據（理由寫在程式中）', () => {
  assert.equal(DEFAULT_REVIEW_POLICY.minEvidence, 1);
  assert.equal(DEFAULT_REVIEW_POLICY.maxDroppedEvidence, 0);
  assert.deepEqual(DEFAULT_REVIEW_POLICY.unknownMarkers, ['無法判斷', '判決原文未載明']);
});

test('設定清理：非法值回到預設、標記去除空白與重複、空標記回到預設', () => {
  assert.deepEqual(normalizeReviewPolicy({ minEvidence: 2.5, maxDroppedEvidence: -1 }), { ...DEFAULT_REVIEW_POLICY, minEvidence: 1, maxDroppedEvidence: 0 });
  assert.deepEqual(normalizeReviewPolicy({ minEvidence: '3', maxDroppedEvidence: 99 }).minEvidence, 3);
  assert.equal(normalizeReviewPolicy({ maxDroppedEvidence: 99 }).maxDroppedEvidence, 0, '超過上限 10 時回到預設');
  assert.deepEqual(normalizeReviewPolicy({ unknownMarkers: [' 無法判斷 ', '無法判斷', ''] }).unknownMarkers, ['無法判斷']);
  assert.deepEqual(normalizeReviewPolicy({ unknownMarkers: ['', '  '] }).unknownMarkers, DEFAULT_REVIEW_POLICY.unknownMarkers);
  assert.deepEqual(normalizeReviewPolicy(undefined), DEFAULT_REVIEW_POLICY);
});

test('規則邊界：空內容、無法判斷標記（開頭相符）', () => {
  assert.deepEqual(decideReview({ value: '  ', evidence: ['x'], dropped: 0 }), { reviewStatus: 'pending', reviewNote: '未取得內容' });
  assert.equal(decideReview({ value: '無法判斷', evidence: ['x'], dropped: 0 }).reviewStatus, 'pending');
  assert.equal(decideReview({ value: '判決原文未載明', evidence: ['x'], dropped: 0 }).reviewStatus, 'pending');
  // 只有開頭是標記才算「無法判斷」；句中出現的字不算（避免誤判正常內容）。
  assert.equal(decideReview({ value: '法院認為無法判斷是否構成侵權', evidence: ['x'], dropped: 0 }).reviewStatus, 'none');
});

test('規則邊界：無依據與依據無效要分開說明', () => {
  const none = decideReview({ value: '駁回', evidence: [], dropped: 0 });
  assert.equal(none.reviewStatus, 'pending');
  assert.match(none.reviewNote, /無依據/);
  const invalid = decideReview({ value: '駁回', evidence: [], dropped: 2 });
  assert.equal(invalid.reviewStatus, 'pending');
  assert.match(invalid.reviewNote, /依據無效：AI 提出的 2 則依據都不在判決原文中/);
});

test('規則邊界：丟棄的依據數與門檻（預設 0：任何無效依據都要覆核）', () => {
  assert.equal(decideReview({ value: '駁回', evidence: ['a'], dropped: 0 }).reviewStatus, 'none');
  const one = decideReview({ value: '駁回', evidence: ['a'], dropped: 1 });
  assert.equal(one.reviewStatus, 'pending');
  assert.match(one.reviewNote, /已移除 1 則/);
  // 放寬為 1：一則無效依據不再需要覆核，兩則仍需要。
  const lenient = { ...DEFAULT_REVIEW_POLICY, maxDroppedEvidence: 1 };
  assert.equal(decideReview({ value: '駁回', evidence: ['a'], dropped: 1 }, lenient).reviewStatus, 'none');
  assert.equal(decideReview({ value: '駁回', evidence: ['a'], dropped: 2 }, lenient).reviewStatus, 'pending');
});

test('規則邊界：有效依據數與門檻（預設 1；設為 2 時單一依據需覆核）', () => {
  assert.equal(decideReview({ value: '駁回', evidence: ['a'], dropped: 0 }).reviewStatus, 'none');
  const strict = { ...DEFAULT_REVIEW_POLICY, minEvidence: 2 };
  const r = decideReview({ value: '駁回', evidence: ['a'], dropped: 0 }, strict);
  assert.equal(r.reviewStatus, 'pending');
  assert.match(r.reviewNote, /有效依據 1 則，低於門檻 2 則/);
  assert.equal(decideReview({ value: '駁回', evidence: ['a', 'b'], dropped: 0 }, strict).reviewStatus, 'none');
});

test('verifyCodedValue 接受門檻參數：同一份回覆在不同規則下結果不同', () => {
  const raw = { value: '駁回', evidence: ['該請求應予駁回', '法院認為被告應賠償一百萬元'] };
  assert.equal(verifyCodedValue(TEXT, field('outcome', '結論'), raw).reviewStatus, 'pending', '預設：有一則無效依據');
  assert.equal(verifyCodedValue(TEXT, field('outcome', '結論'), raw, { ...DEFAULT_REVIEW_POLICY, maxDroppedEvidence: 1 }).reviewStatus, 'none');
});

test('高信心：系統判定可接受、內容非空、依據達門檻；待覆核與已覆核的結果不算', () => {
  const ok = verifyCodedValue(TEXT, field('issue', '爭點'), { value: '國家賠償請求', evidence: ['依國家賠償法第二條第二項請求賠償'] });
  assert.equal(isHighConfidence(ok), true);
  const pending = verifyCodedValue(TEXT, field('issue', '爭點'), { value: '', evidence: [] });
  assert.equal(isHighConfidence(pending), false);
  assert.equal(isHighConfidence(reviewValue(ok, 'accept', AT)), false, '已接受的不再計入高信心');
});

test('覆核操作：接受、駁回；每次都保存操作前的值，還原後回到原狀', () => {
  const v = verifyCodedValue(TEXT, field('outcome', '結論'), { value: '駁回', evidence: ['該請求應予駁回', '法院認為被告應賠償'] });
  assert.equal(v.reviewStatus, 'pending');
  const accepted = reviewValue(v, 'accept', AT);
  assert.equal(accepted.reviewStatus, 'accepted');
  assert.equal(accepted.reviewHistory.length, 1);
  assert.deepEqual(accepted.reviewHistory[0].before, { value: '駁回', reviewStatus: 'pending', reviewNote: v.reviewNote });
  const back = undoReview(accepted);
  assert.equal(back.reviewStatus, 'pending');
  assert.equal(back.reviewHistory, undefined);
  assert.equal(undoReview(back), back, '沒有紀錄時原樣回傳');
  const rejected = reviewValue(v, 'reject', AT);
  assert.equal(rejected.reviewStatus, 'rejected');
  assert.equal(v.reviewStatus, 'pending', '輸入物件不被改動');
});

test('覆核操作：修改內容保留 AI 原文；多次修改可逐步還原', () => {
  const v = verifyCodedValue(TEXT, field('issue', '爭點'), { value: 'AI 的爭點', evidence: ['依國家賠償法第二條第二項請求賠償'] });
  const e1 = reviewValue(v, 'edit', AT, '  國賠請求  ');
  assert.equal(e1.value, '國賠請求');
  assert.equal(e1.aiValue, 'AI 的爭點');
  assert.equal(e1.reviewStatus, 'accepted');
  const e2 = reviewValue(e1, 'edit', AT, '國家賠償責任');
  assert.equal(e2.aiValue, 'AI 的爭點', 'AI 原文只記一次');
  const u1 = undoReview(e2);
  assert.equal(u1.value, '國賠請求');
  const u2 = undoReview(u1);
  assert.equal(u2.value, 'AI 的爭點');
  assert.equal(u2.aiValue, undefined, '全部還原後不留修改紀錄');
  assert.equal(u2.reviewStatus, 'none');
});

test('批次接受：只接受高信心結果，待覆核與已駁回的不動；可整批還原', () => {
  const sheet = {
    analyses: [
      { id: 'a', values: [
        verifyCodedValue(TEXT, field('issue', '爭點'), { value: '國賠請求', evidence: ['依國家賠償法第二條第二項請求賠償'] }),
        verifyCodedValue(TEXT, field('outcome', '結論'), { value: '駁回', evidence: [] }),
      ] },
      { id: 'b', values: [
        verifyCodedValue(TEXT, field('issue', '爭點'), { value: '國賠請求', evidence: ['依國家賠償法第二條第二項請求賠償'] }),
      ] },
    ],
  };
  const { sheets, changed } = applyReviewOp([sheet], { kind: 'batch-accept', sheetIndex: 0 }, DEFAULT_REVIEW_POLICY, AT);
  assert.deepEqual(changed.map((c) => `${c.caseId}:${c.fieldId}`), ['a:issue', 'b:issue']);
  assert.equal(sheets[0].analyses[0].values[0].reviewStatus, 'accepted');
  assert.equal(sheets[0].analyses[0].values[1].reviewStatus, 'pending', '待覆核的不接受');
  assert.equal(sheet.analyses[0].values[0].reviewStatus, 'none', '輸入不被改動');

  const undone = applyReviewOp(sheets, { kind: 'undo', cells: changed }, DEFAULT_REVIEW_POLICY, AT).sheets;
  assert.equal(undone[0].analyses[0].values[0].reviewStatus, 'none');
  assert.equal(undone[0].analyses[1].values[0].reviewStatus, 'none');
});

test('單格操作：接受、修改、駁回透過 applyReviewOp；修改為空白時拒絕；找不到的格子略過', () => {
  const sheet = { analyses: [{ id: 'a', values: [verifyCodedValue(TEXT, field('issue', '爭點'), { value: '爭點', evidence: ['依國家賠償法第二條第二項請求賠償'] })] }] };
  const cell = { sheetIndex: 0, caseId: 'a', fieldId: 'issue' };
  const acc = applyReviewOp([sheet], { kind: 'accept', cell }).sheets;
  assert.equal(acc[0].analyses[0].values[0].reviewStatus, 'accepted');
  const edit = applyReviewOp([sheet], { kind: 'edit', cell, value: '新爭點' }).sheets;
  assert.equal(edit[0].analyses[0].values[0].value, '新爭點');
  assert.equal(edit[0].analyses[0].values[0].aiValue, '爭點');
  assert.throws(() => applyReviewOp([sheet], { kind: 'edit', cell, value: '   ' }), /不可為空白/);
  const rej = applyReviewOp([sheet], { kind: 'reject', cell }).sheets;
  assert.equal(rej[0].analyses[0].values[0].reviewStatus, 'rejected');
  const missing = applyReviewOp([sheet], { kind: 'accept', cell: { sheetIndex: 0, caseId: 'zz', fieldId: 'issue' } });
  assert.deepEqual(missing.changed, []);
});

test('覆核摘要：各狀態計數與高信心數量', () => {
  const sheet = {
    analyses: [
      { id: 'a', values: [
        verifyCodedValue(TEXT, field('issue', '爭點'), { value: '國賠', evidence: ['依國家賠償法第二條第二項請求賠償'] }),
        verifyCodedValue(TEXT, field('outcome', '結論'), { value: '無法判斷', evidence: [] }),
      ] },
    ],
  };
  assert.deepEqual(summarizeReview(sheet), { total: 2, pending: 1, accepted: 0, rejected: 0, highConfidence: 1 });
  assert.deepEqual(summarizeReview({}), { total: 0, pending: 0, accepted: 0, rejected: 0, highConfidence: 0 });
});

test('匯出文字：覆核狀態與 AI 原文都會寫入儲存格', () => {
  const v = verifyCodedValue(TEXT, field('outcome', '結論'), { value: '駁回', evidence: ['該請求應予駁回'] });
  assert.equal(formatCodedCell(reviewValue(v, 'accept', AT)), '駁回\n依據：該請求應予駁回\n【已接受】');
  const edited = reviewValue(v, 'edit', AT, '駁回上訴');
  assert.equal(formatCodedCell(edited), '駁回上訴\nAI 原文：駁回\n依據：該請求應予駁回\n【已修改】');
  assert.equal(formatCodedCell(reviewValue(v, 'reject', AT)), '駁回\n依據：該請求應予駁回\n【已駁回】');
});
