// 匯出：研究設計摘要 Word（做法與 exporters.ts 相同：段落與標題，字型沿用微軟正黑體）。
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import type { DesignSummary } from '@judge/core';

const font = 'Microsoft JhengHei';
const para = (text: string, size = 24) =>
  new Paragraph({ spacing: { after: 120, line: 360 }, children: [new TextRun({ text, size, font })] });
const heading = (text: string) =>
  new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true, font })] });

export async function buildDesignDocx(sum: DesignSummary): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '研究設計摘要', bold: true, size: 32, font })],
    }),
    para(`研究問題：${sum.researchQuestion}`),
    para(`研究對象：${sum.subject}`),
    para(`變項：${sum.variable}`),
    para(`期間：${sum.period}`),
    para(`法規：${sum.statute}`),
  ];
  if (sum.manualFilters.length) children.push(para(`需人工篩選：${sum.manualFilters.join('；')}`));
  children.push(heading('分析方式'), ...sum.analysisPlan.map((p) => para(`・${p}`)));
  children.push(heading('限制'), ...sum.limitations.map((p) => para(`・${p}`)));
  if (sum.rationales.length) children.push(heading('各步驟理由'), ...sum.rationales.map((p) => para(`・${p}`)));
  if (sum.acceptedSuggestions.length) children.push(heading('已接受的建議'), ...sum.acceptedSuggestions.map((p) => para(`・${p}`)));
  const document = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(document));
}
