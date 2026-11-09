// 單一判決精讀服務：AI 整理成文書、存入檔案管理，並（若有原版 PDF）產生螢光標示的 Word 版。
import {
  briefJudgment, normalizeBriefFields, CourtClient, openPdf, pagesNeedingOcr, renderPageWithHighlights,
  type BriefField, type BriefDocument, type JudgmentDetail, type AiComplete,
} from '@judge/core';
import { shell } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { buildFourPerPageDocx, groupPages, type PageImage } from '../pdfWord';
import { library } from '../data/local/libraryAccess';
import { cachedDetail } from '../data/cloud/courtRepo';
import { exportDir } from './exportService';

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
  const d = await cachedDetail(args.judgmentId, undefined, args.jurisdiction);
  const fields = normalizeBriefFields(args.fields ?? []);
  const doc: BriefDocument = await briefJudgment(ai, d, { focus: args.focus, length: args.lengthHint, fields: fields.length ? fields : undefined });
  await library().add({
    kind: 'brief',
    title: `精讀：${d.meta.title || args.judgmentId}`,
    summary: d.meta.court ?? '',
    payload: { detail: d, doc },
  });
  const annotated = await annotateOriginalPdf(d, doc).catch((err) => ({ error: err instanceof Error ? err.message : String(err), files: [] as string[] }));
  return { detail: d, doc, annotated };
}
