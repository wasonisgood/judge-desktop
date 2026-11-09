// 單一判決精讀服務：AI 整理成文書、存入檔案管理，並（若有原版 PDF）產生螢光標示的 Word 版。
import {
  briefJudgment, normalizeBriefFields, CourtClient, openPdf, pagesNeedingOcr, renderPageWithHighlights,
  newTrace, addStep, explainTrace, type BriefField, type BriefDocument, type JudgmentDetail, type AiComplete,
} from '@judge/core';
import { shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildFourPerPageDocx, groupPages, type PageImage } from '../pdfWord';
import { library } from '../data/local/libraryAccess';
import { cachedDetail } from '../data/cloud/courtRepo';
import { exportDir } from './exportService';
import { lawContextForCitations } from './lawContext';

export interface AnnotateResult {
  files: string[];
  pages: number;
  highlighted: number;
  ocrPages: number[];
  quotes: number;
  error?: string;
}

/**
 * 原版 PDF 標示：下載判決的原版 PDF，把精讀引用的原文以螢光色標示，
 * 每 4 頁存成一份 Word（2×2 格）。沒有文字層的頁面會回報，不猜位置。
 */
export async function annotateOriginalPdf(d: JudgmentDetail, doc: BriefDocument): Promise<AnnotateResult> {
  if (!d.pdfUrl) return { files: [], pages: 0, highlighted: 0, ocrPages: [], quotes: 0, error: '此判決沒有原版 PDF 連結' };
  const bytes = await new CourtClient().requestBytes(d.pdfUrl, { headers: { referer: d.meta.sourceUrl } });
  const pdf = await openPdf(bytes);
  const quotes = [...new Set(doc.sections.flatMap((sec) => sec.evidence ?? []))];
  const ocrPages = await pagesNeedingOcr(pdf);
  const pages: PageImage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const r = await renderPageWithHighlights(pdf, n, quotes, 2.4);
    pages.push({ pageNo: n, png: r.png, widthPx: r.widthPx, heightPx: r.heightPx, highlighted: r.highlighted });
  }
  const label = (d.meta.caseNo ?? d.meta.id).replace(/[\/:*?"<>|]/g, '_');
  const dir = exportDir('原版標示');
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  const summary = { title: doc.title, sections: doc.sections.map((sec) => ({ heading: sec.heading, paragraphs: sec.paragraphs })) };
  for (const [idx, group] of groupPages(pages, 4).entries()) {
    const from = group[0].pageNo, to = group[group.length - 1].pageNo;
    const file = path.join(dir, `原版標示_${label}_第${from}-${to}頁.docx`);
    await fs.writeFile(file, await buildFourPerPageDocx(group, `${d.meta.title || label}（第 ${from}–${to} 頁）`, idx === 0 ? summary : undefined));
    files.push(file);
  }
  if (files[0]) void shell.openPath(files[0]);
  return { files, pages: pages.length, highlighted: pages.reduce((n, p) => n + p.highlighted, 0), ocrPages, quotes: quotes.length };
}

export async function runBrief(
  args: { judgmentId: string; focus: string; lengthHint: string; fields?: BriefField[]; jurisdiction?: string },
  ai: AiComplete,
) {
  const trace = newTrace('精讀');
  const d = await cachedDetail(args.judgmentId, undefined, args.jurisdiction);
  addStep(trace, { stage: '取得判決內頁', module: 'rule', input: args.judgmentId, output: `${d.fullText.length} 字`, decision: 'pass', reason: '判決原文已取得' });
  const fields = normalizeBriefFields(args.fields ?? []);
  // 法規上下文（issue #4 第 4 點）：判決引用的法條現行內容與沿革交給 AI 判讀。
  const lc = await lawContextForCitations(d.relatedLaws ?? []);
  addStep(trace, {
    stage: '讀入法規現行條文與沿革', module: 'rule', input: `${(d.relatedLaws ?? []).length} 條相關法條`,
    output: lc.text ? '已讀入' : '未取得', decision: 'pass', reason: lc.notes.length ? lc.notes.join('；') : '法規內容已交給 AI 判讀',
  });
  const doc: BriefDocument = await briefJudgment(ai, d, { focus: args.focus, length: args.lengthHint, fields: fields.length ? fields : undefined, lawContext: lc.text || undefined });
  addStep(trace, { stage: 'AI 整理文書', module: 'cloud', input: `${fields.length || '預設'} 個欄位；重點：${args.focus || '（未指定）'}`, output: `${doc.sections.length} 段`, decision: 'pass', reason: '只根據判決原文整理' });
  const dropped = doc.droppedQuotes ?? 0;
  addStep(trace, {
    stage: '引文驗證', module: 'rule', input: '各段引文與判決原文逐字比對',
    output: dropped ? `移除 ${dropped} 則無法在原文中找到的引文` : '全部引文都在原文中',
    decision: 'pass', reason: dropped ? '找不到原文依據的引文不保留（不猜）' : '引文皆可驗證',
  });
  await library().add({
    kind: 'brief',
    title: `精讀：${d.meta.title || args.judgmentId}`,
    summary: d.meta.court ?? '',
    payload: { detail: d, doc, trace },
  });
  const annotated = await annotateOriginalPdf(d, doc).catch((err) => ({ error: err instanceof Error ? err.message : String(err), files: [] as string[] }));
  addStep(trace, {
    stage: '原版 PDF 標示', module: 'rule', input: d.pdfUrl ? '原版 PDF' : '無原版 PDF 連結',
    output: annotated.error ? `未完成：${annotated.error}` : `${annotated.files.length} 份 Word，標示 ${"quotes" in annotated ? annotated.quotes : 0} 則引文`,
    decision: annotated.error ? 'skip' : 'pass', reason: annotated.error ? '標示失敗不影響精讀文書' : '原版標示完成',
  });
  return { detail: d, doc, annotated, trace, explanation: explainTrace(trace) };
}
