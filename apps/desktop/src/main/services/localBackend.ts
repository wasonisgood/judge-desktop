// 執行期：供 requireAi 使用。AI 引擎模組為 ready 且服務可用時，回傳本地後端；否則 null（改走雲端）。
import { OllamaBackend } from '@judge/core';
import { AI_ENGINE_MODULE_ID, OWN_BASE } from '../data/local/localPaths';
import { readPlan, readEngine } from '../data/local/engineStore';
import { readModuleStatus } from '../data/local/registryStore';
import { engineBaseOverride } from '../data/local/ollamaService';
import { readSettings } from '../data/local/settingsStore';

export async function localBackendIfReady(opts: { ignoreSwitch?: boolean } = {}): Promise<{ kind: 'local'; run: <T>(task: 'judgment' | 'chat' | 'crawl', payload: unknown) => Promise<T> } | null> {
  // 使用者在設定中關閉本地模組時，即使已安裝也只走雲端；明確選擇「本地」時（ignoreSwitch）才會忽略此開關。
  if (!opts.ignoreSwitch && !(await readSettings()).localAiEnabled) return null;
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
