// IPC 總入口：依領域註冊各組 handler。通道名稱與行為與拆分前完全相同。
import { registerWindowIpc } from './windowIpc';
import { registerLocalIpc } from './localIpc';
import { registerSettingsIpc } from './settingsIpc';
import { registerSearchIpc } from './searchIpc';
import { registerScopeIpc } from './scopeIpc';
import { registerLibraryIpc } from './libraryIpc';
import { registerAssistantIpc } from './assistantIpc';
import { registerBriefIpc } from './briefIpc';
import { registerAuthIpc } from './authIpc';
import { registerJobsIpc } from './jobsIpc';
import { registerKnowledgeIpc } from './knowledgeIpc';
import { registerChartIpc } from './chartIpc';

export function registerIpc(): void {
  registerAuthIpc();
  registerWindowIpc();
  registerLocalIpc();
  registerSettingsIpc();
  registerSearchIpc();
  registerScopeIpc();
  registerLibraryIpc();
  registerAssistantIpc();
  registerBriefIpc();
  registerJobsIpc();
  registerKnowledgeIpc();
  registerChartIpc();
}
