// 流程紀錄與說明（issue #4 第 7 點）：每一輪查詢、篩選、分析都記成一步，說明視窗依此產生文字。
// 只記錄事實（輸入摘要、輸出摘要、判斷與理由），不含金鑰、不含判決全文。

export type TraceModule = 'rule' | 'local' | 'cloud' | 'ai' | 'user';
export type TraceDecision = 'pass' | 'stop' | 'retry' | 'skip' | 'ask' | 'capped';

export interface TraceStep {
  /** 階段名稱，例如「判決搜尋」「AI 篩選」「逐案分析」。 */
  stage: string;
  /** 執行的模組：規則程式、本地 AI、雲端 AI、或使用者。 */
  module: TraceModule;
  /** 這一步的輸入摘要，例如搜尋的關鍵字。 */
  input: string;
  /** 這一步的輸出摘要，例如命中筆數。 */
  output: string;
  /** 判斷結果：放行到下一步、停止、重試、略過、詢問使用者、或達到重試上限。 */
  decision: TraceDecision;
  /** 判斷理由，一句話。 */
  reason: string;
}

export interface PipelineTrace {
  /** 功能名稱，例如「判決列表」「範圍整理」「精讀」。 */
  feature: string;
  steps: TraceStep[];
}

export function newTrace(feature: string): PipelineTrace {
  return { feature, steps: [] };
}

export function addStep(trace: PipelineTrace, step: TraceStep): void {
  trace.steps.push(step);
}

const MODULE_LABEL: Record<TraceModule, string> = {
  rule: '規則程式',
  local: '本地 AI',
  cloud: '雲端 AI',
  ai: 'AI',
  user: '使用者',
};

const DECISION_LABEL: Record<TraceDecision, string> = {
  pass: '放行到下一步',
  stop: '停止',
  retry: '重試',
  skip: '略過',
  ask: '詢問使用者',
  capped: '達到重試上限，輸出現有結果',
};

/** 說明視窗的內容：標題與段落（每段一句，依序）。 */
export interface TraceExplanation {
  title: string;
  paragraphs: string[];
}

/** 把流程紀錄轉成繁體中文說明，每一步一段，最後說明最終放行或停止的原因。 */
export function explainTrace(trace: PipelineTrace): TraceExplanation {
  const paragraphs: string[] = [];
  trace.steps.forEach((s, i) => {
    paragraphs.push(
      `第 ${i + 1} 步「${s.stage}」由${MODULE_LABEL[s.module]}處理：輸入 ${s.input || '（無）'}；輸出 ${s.output || '（無）'}；判斷為${DECISION_LABEL[s.decision]}，理由：${s.reason}`,
    );
  });
  const last = trace.steps[trace.steps.length - 1];
  if (last) {
    paragraphs.push(
      last.decision === 'capped'
        ? `共執行 ${trace.steps.length} 步，已達重試上限，因此輸出目前已找到的結果。`
        : `共執行 ${trace.steps.length} 步，最後一步放行生成結果。`,
    );
  } else {
    paragraphs.push('沒有執行任何步驟。');
  }
  return { title: `${trace.feature}：處理流程說明`, paragraphs };
}
