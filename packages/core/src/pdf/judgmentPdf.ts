// 原版判決 PDF：下載、找出 AI 引用原文在頁面上的位置、畫成頁面圖並以螢光色標示。
// 文字層：以 pdf.js 讀取（新式 PDF 有文字層）。沒有文字層的掃描頁會回報為「需要 OCR」，不猜位置。
// 繪圖：@napi-rs/canvas（pdf.js 的畫布工廠）。
const pdfjs: any = require('pdfjs-dist/legacy/build/pdf.js');
// 原生繪圖模組只在需要時才載入，避免打包後啟動時就載入失敗而影響整個應用程式。
function canvasModule(): any {
  return require('@napi-rs/canvas');
}
function createCanvas(w: number, h: number): any {
  return canvasModule().createCanvas(w, h);
}

export interface PdfPageText {
  pageNo: number;
  /** 合併後的字串（用於比對）。 */
  text: string;
  /** 每個字元對應的文字項目編號。 */
  charItem: number[];
  items: { x: number; y: number; w: number; h: number; str: string }[];
  width: number;
  height: number;
  hasText: boolean;
}

/** 比對用的正規化：去掉空白與全形/半形差異。 */
export function normalizeForPdfMatch(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/，/g, ',').replace(/：/g, ':').replace(/；/g, ';')
    .replace(/（/g, '(').replace(/）/g, ')').replace(/　/g, '');
}

/** 驗證下載內容確實是 PDF。 */
export function assertIsPdf(buf: Buffer): void {
  if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('下載的內容不是 PDF（網站可能改版或需要重新查詢）');
  }
}

const canvasFactory = {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    return { canvas, context: canvas.getContext('2d') };
  },
  reset(cc: any, width: number, height: number) {
    cc.canvas.width = Math.max(1, Math.floor(width));
    cc.canvas.height = Math.max(1, Math.floor(height));
  },
  destroy(cc: any) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  },
};

export async function openPdf(buf: Buffer): Promise<any> {
  assertIsPdf(buf);
  return pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, canvasFactory, verbosity: 0 }).promise;
}

/** 取出每一頁的文字項目與位置（PDF 座標）。 */
export async function extractPageTexts(doc: any): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: PdfPageText['items'] = [];
    let text = '';
    const charItem: number[] = [];
    for (const it of tc.items as any[]) {
      if (!it.str) continue;
      const idx = items.length;
      items.push({ x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]), str: it.str });
      for (const ch of it.str) {
        const norm = normalizeForPdfMatch(ch);
        if (!norm) continue;
        text += norm;
        charItem.push(idx);
      }
    }
    pages.push({ pageNo: n, text, charItem, items, width: vp.width, height: vp.height, hasText: text.length > 0 });
  }
  return pages;
}

/**
 * 在一頁中找出引文，回傳它的矩形（PDF 座標，左下為原點）。
 * 引文以正規化後比對；太短（少於 6 字）的引文不採用，避免誤中。
 */
export function findQuoteBoxes(page: PdfPageText, quote: string): { x: number; y: number; w: number; h: number }[] {
  const q = normalizeForPdfMatch(quote);
  if (q.length < 6) return [];
  const at = page.text.indexOf(q);
  if (at < 0) return [];
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  const seen = new Set<number>();
  for (let i = at; i < at + q.length; i++) {
    const idx = page.charItem[i];
    if (idx === undefined || seen.has(idx)) continue;
    seen.add(idx);
    const it = page.items[idx];
    boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h });
  }
  return boxes;
}

/**
 * 把一頁畫成 PNG，並在引文位置畫上螢光色。
 * @param quotes 要標示的引文（須為原版 PDF 文字中的內容）。
 */
export async function renderPageWithHighlights(
  doc: any,
  pageNo: number,
  quotes: string[],
  scale = 1.6,
): Promise<{ png: Buffer; widthPx: number; heightPx: number; highlighted: number }> {
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const texts = (await extractPageTexts(doc)).find((p) => p.pageNo === pageNo);
  let highlighted = 0;
  if (texts && texts.hasText) {
    ctx.fillStyle = 'rgba(255, 221, 0, 0.42)';
    for (const quote of quotes) {
      for (const b of findQuoteBoxes(texts, quote)) {
        const p1 = viewport.convertToViewportPoint(b.x, b.y);
        const p2 = viewport.convertToViewportPoint(b.x + b.w, b.y + b.h);
        const x = Math.min(p1[0], p2[0]);
        const y = Math.min(p1[1], p2[1]);
        ctx.fillRect(x, y, Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]));
        highlighted++;
      }
    }
  }
  const png = Buffer.from(await canvas.encode('png'));
  return { png, widthPx: canvas.width, heightPx: canvas.height, highlighted };
}

/** 頁面文字是否可用（沒有文字層的掃描頁需要 OCR）。 */
export async function pagesNeedingOcr(doc: any): Promise<number[]> {
  const pages = await extractPageTexts(doc);
  return pages.filter((p) => !p.hasText).map((p) => p.pageNo);
}
