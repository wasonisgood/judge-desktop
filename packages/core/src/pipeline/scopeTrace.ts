// 標編碼標注工序的處理流程說明：把流程紀錄（PipelineTrace）逐步轉成繁體中文句子。
// 每一句都只由該步驟記錄的輸入、輸出、判斷與理由組成，不寫死結果；沒有的步驟就不會出現。
import type { PipelineTrace, TraceExplanation, TraceStep } from './trace';
import { explainTrace } from './trace';

/** 說明視窗最後一段的結果數字（由呼叫端依實際結果提供）。 */
export interface ScopeTraceSummary {
  sheets: number;
  rows: number;
  pending: number;
}

const ROUND_STAGE = /^第 \d+ 輪篩選判決$/;

/** 單一步驟的說明；回傳 null 表示此步驟不需要在說明中出現。 */
export function describeStep(s: TraceStep): string | null {
  const out = s.output || '（無）';
  const input = s.input || '（無）';
  switch (true) {
    case s.stage === 'AI 分析設定':
      return `AI 設定：${out}。${s.reason}。`;
    case s.stage === '確認法名':
      return s.decision === 'ask'
        ? `法規「${input}」有多個正式法名，請使用者選擇：${out}。`
        : `法規確認：「${input}」對應「${out}」。`;
    case s.stage === '讀入法規現行條文':
      return out === '失敗'
        ? `現行條文讀取失敗（${s.reason}），AI 只依判決原文判讀。`
        : `現行條文：${out}，篩選與編碼時對照。`;
    case s.stage === '讀入法規現行條文與沿革':
      return `相關法規「${input}」的現行條文與沿革：${out}，提供 AI 提議關鍵字時參考。`;
    case s.stage === '讀入爭點知識庫':
      return `爭點知識庫：${out}，已交給 AI 參考。`;
    case ROUND_STAGE.test(s.stage): {
      const tail = s.decision === 'retry' ? '；結果不足，改用 AI 提議的關鍵字再查' : s.decision === 'capped' ? '；已達搜尋上限' : '';
      return `${s.stage}：以「${input}」搜尋，${out}${tail}。`;
    }
    case s.stage === '提議新關鍵字':
      return out.includes('沒有')
        ? `AI 沒有提議新的關鍵字，改以目前結果輸出。`
        : `AI 無法提議新的關鍵字（${s.reason}），改以目前已找到的結果輸出。`;
    case s.stage === '語意確認':
      return `AI 判定需求語意不清，請使用者選擇：${out}。`;
    case s.stage === '相關法規篩選':
      return `相關法規篩選：${input} → ${out}（${s.reason}）。`;
    case s.stage === '整理篩選結果':
      return `篩選結果：${out}（${s.reason}）。`;
    case s.stage === 'AI 逐案編碼':
      return `AI 逐案編碼（${input}）：${out}。`;
    case s.stage === '依據逐字驗證':
      return `依據驗證：${out}（${s.reason}）。`;
    case s.stage === '待覆核標示':
      return `待覆核：${out}（${s.reason}）。`;
    case s.stage === 'AI 綜合分析':
      return s.decision === 'skip'
        ? `綜合分析失敗（${s.reason}），只保留逐案編碼結果。`
        : `綜合分析：${out}。`;
    case s.stage === '整理此法規' || s.stage === '整理關鍵字':
      return `「${input}」整理失敗（${s.reason}），其餘照常處理。`;
    case s.stage === '取消':
      return `使用者取消：${out}。`;
    case s.stage === 'AI 逐案與綜合分析':
      return `AI 編碼：${out}。`;
    default:
      return `${s.stage}：${out}。${s.reason}。`;
  }
}

/**
 * 標編碼標注工序的說明視窗內容。
 * 步驟來自實際執行的流程紀錄；summary 只用於最後一段的結果數字。
 */
export function explainScopeTrace(trace: PipelineTrace, summary?: ScopeTraceSummary): TraceExplanation {
  const paragraphs = trace.steps.map(describeStep).filter((x): x is string => !!x);
  if (summary) {
    paragraphs.push(`結果：${summary.sheets} 組，共 ${summary.rows} 筆${summary.pending ? `，其中 ${summary.pending} 格待覆核` : ''}。`);
  }
  if (paragraphs.length === 0) return explainTrace(trace);
  return { title: `${trace.feature}：處理流程說明`, paragraphs };
}
