// 範圍整理服務：依法規逐一確認法名、取得法條沿革、篩選判決、逐案 AI 分析、綜合分析，最後存入檔案管理。
import {
  jurisdictionRegistry, buildScopeTable, CourtClient, analyzeCase, synthesizeScope,
  type CaseAnalysis, type ScopeRow, type ScopeSynthesis, type AiComplete,
} from '@judge/core';
import type { ScopeSheet } from '../scopeExporters';
import { library } from '../data/local/libraryAccess';
import { resolveStatute, lawHistoryFor } from '../data/cloud/lawRepo';
import { cachedDetail } from '../data/cloud/courtRepo';
import { splitStatuteLine, rowCites } from './statuteInput';

export interface ScopeRunArgs {
  statutes: string[];
  yearFrom?: number;
  yearTo?: number;
  maxItems: number;
  /** 法院管轄區；未指定為台灣司法院。法規名稱確認與法條沿革目前只支援台灣法規資料庫。 */
  jurisdiction?: string;
  /** AI 來源：auto、local、cloud（見 aiRepo）。 */
  ai?: string;
}

export interface ScopeProgress {
  statute: string;
  done: number;
  total: number;
  phase: string;
}

export async function runScope(
  args: ScopeRunArgs,
  ai: AiComplete,
  onProgress: (p: ScopeProgress) => void,
): Promise<{ sheets: ScopeSheet[]; notes: string[] }> {
  const sheets: ScopeSheet[] = [];
  const notes: string[] = [];
  const client = new CourtClient();
  for (const line of args.statutes) {
    const { name, citation } = splitStatuteLine(line);
    onProgress({ statute: name, done: 0, total: 1, phase: '確認法名與法條沿革' });
    // 只有支援法規查詢的管轄區（台灣）才做法名確認與法條沿革；其他管轄區以輸入的名稱直接搜尋。
    const lookup = jurisdictionRegistry.get(args.jurisdiction).statuteLookup;
    const statute = lookup ? await resolveStatute(name) : { name, pcode: '', note: undefined as string | undefined };
    if (statute.note) notes.push(statute.note);
    const lawHistory = lookup ? await lawHistoryFor(statute.name) : [];
    let rows: ScopeRow[] = await buildScopeTable({
      statute: statute.name,
      yearFrom: args.yearFrom,
      yearTo: args.yearTo,
      maxItems: args.maxItems,
      client,
      jurisdiction: args.jurisdiction,
      lawHistory,
      onProgress: (done, total) => onProgress({ statute: statute.name, done, total, phase: '篩選判決' }),
    });
    if (citation) rows = rows.filter((r) => rowCites(r, citation));
    const analyses: CaseAnalysis[] = [];
    for (let i = 0; i < rows.length; i++) {
      onProgress({ statute: statute.name, done: i + 1, total: rows.length, phase: 'AI 逐案分析' });
      const d = await cachedDetail(rows[i].id, client, args.jurisdiction);
      analyses.push(await analyzeCase(ai, statute.name, rows[i], d));
    }
    onProgress({ statute: statute.name, done: 1, total: 1, phase: 'AI 綜合分析' });
    const synthesis: ScopeSynthesis | null = rows.length
      ? await synthesizeScope(ai, statute.name, analyses)
      : null;
    sheets.push({ statute: citation ? `${statute.name}${line.trim().slice(name.length)}` : statute.name, rows, analyses, synthesis });
  }
  const total = sheets.reduce((n, sh) => n + sh.rows.length, 0);
  await library().add({
    kind: 'scope',
    title: `範圍整理：${args.statutes.join('、')}`,
    summary: `${sheets.length} 部法規，共 ${total} 筆`,
    payload: { sheets, yearFrom: args.yearFrom, yearTo: args.yearTo },
  });
  return { sheets, notes };
}
