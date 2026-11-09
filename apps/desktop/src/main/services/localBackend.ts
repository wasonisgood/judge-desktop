// 執行期：供 requireAi 使用。AI 引擎模組為 ready 且服務可用時，回傳本地後端；否則 null（改走雲端）。
import { OllamaBackend } from '@judge/core';
import { AI_ENGINE_MODULE_ID, OWN_BASE } from '../data/local/localPaths';
import { readPlan, readEngine } from '../data/local/engineStore';
import { readModuleStatus } from '../data/local/registryStore';
import { engineBaseOverride } from '../data/local/ollamaService';

export async function localBackendIfReady(): Promise<{ kind: 'local'; run: <T>(task: 'judgment' | 'chat' | 'crawl', payload: unknown) => Promise<T> } | null> {
  const st = (await readModuleStatus())[AI_ENGINE_MODULE_ID];
  const plan = await readPlan();
  if (st.status !== 'ready' || !plan || plan.tier === 'none' || !plan.judgmentModel || !plan.chatModel) return null;
  const eng = await readEngine();
  const base = eng.baseUrl ?? (engineBaseOverride() || OWN_BASE);
  const ollama = new OllamaBackend({ judgment: plan.judgmentModel, chat: plan.chatModel }, { baseUrl: base });
  return {
    kind: 'local',
    run: async <T>(task: 'judgment' | 'chat' | 'crawl', payload: unknown) => {
      const r = await ollama.run<{ text: string }>(task, payload);
      return r.text as unknown as T;
    },
  };
}
