// 預載腳本：只暴露必要的 IPC 介面，畫面無法直接取得 Node 能力。
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  appInfo: () => invoke('app:info'),
  updaterStatus: () => invoke('app:updaterStatus'),
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch: Record<string, unknown>) => invoke('settings:set', patch),
    test: () => invoke('ai:test'),
    federationStatus: () => invoke('federation:status'),
    federationCheck: (args: unknown) => invoke('federation:check', args),
    federationPreviewSub: () => invoke('federation:previewSub'),
  },
  cache: { clear: () => invoke('cache:clear') },
  jurisdictions: { list: () => invoke('jurisdictions:list') },
  search: {
    run: (args: unknown) => invoke('search:run', args),
    screen: (args: unknown) => invoke('search:screen', args),
    manual: (args: unknown) => invoke('search:manual', args),
    smart: (args: unknown) => invoke('search:smart', args),
    onProgress: (cb: (p: { done: number; total: number; id: string }) => void) => {
      ipcRenderer.on('search:progress', (_e, p) => cb(p));
    },
  },
  exportList: (args: unknown) => invoke('export:list', args),
  jobs: {
    list: () => invoke('jobs:list'),
    cancel: (args: unknown) => invoke('jobs:cancel', args),
    onChanged: (cb: (list: unknown) => void) => {
      ipcRenderer.on('jobs:changed', (_e, list) => cb(list));
    },
  },
  scope: {
    run: (args: unknown) => invoke('scope:run', args),
    export: (args: unknown) => invoke('export:scope', args),
    onProgress: (cb: (p: { statute: string; done: number; total: number }) => void) => {
      ipcRenderer.on('scope:progress', (_e, p) => cb(p));
    },
  },
  brief: {
    run: (args: unknown) => invoke('brief:run', args),
    export: (args: unknown) => invoke('export:brief', args),
  },
  update: { openUpdater: () => invoke('update:openUpdater') },
  auth: {
    status: () => invoke('auth:status'),
    start: () => invoke('auth:start'),
    cancel: () => invoke('auth:cancel'),
    signOut: () => invoke('auth:signOut'),
  },
  knowledge: {
    status: () => invoke('knowledge:status'),
    install: () => invoke('knowledge:install'),
  },
  localAi: {
    modules: () => invoke('local:modules'),
    jobStatus: () => invoke('local:jobStatus'),
    plan: () => invoke('local:plan'),
    installAi: (args: { choice: string }) => invoke('local:installAi', args),
    installCrawler: () => invoke('local:installCrawler'),
    repair: (args: { action: string }) => invoke('local:repair', args),
    onProgress: (cb: (p: unknown) => void) => {
      ipcRenderer.on('local:progress', (_e, p) => cb(p));
    },
    diagnose: () => invoke('local:diagnose'),
    exportReport: () => invoke('local:exportReport'),
    openWizard: (args?: { view?: 'install' | 'diag' }) => invoke('local:openWizard', args),
    wizardDone: () => invoke('local:wizardDone'),
    onChanged: (cb: () => void) => {
      ipcRenderer.on('local:changed', () => cb());
    },
  },
  law: {
    resolve: (args: unknown) => invoke('law:resolve', args),
    current: (args: unknown) => invoke('law:current', args),
  },
  judgment: {
    find: (args: unknown) => invoke('judgment:find', args),
  },
  assistant: {
    chat: (args: unknown) => invoke('assistant:chat', args),
  },
  library: {
    list: (args: unknown) => invoke('library:list', args),
    update: (args: unknown) => invoke('library:update', args),
    remove: (args: unknown) => invoke('library:remove', args),
  },
  annotation: {
    load: (args: unknown) => invoke('annotation:load', args),
    add: (args: unknown) => invoke('annotation:add', args),
    update: (args: unknown) => invoke('annotation:update', args),
    remove: (args: unknown) => invoke('annotation:remove', args),
    reanchor: (args: unknown) => invoke('annotation:reanchor', args),
    importAi: (args: unknown) => invoke('annotation:importAi', args),
    judgments: () => invoke('annotation:judgments'),
    export: (args: unknown) => invoke('annotation:export', args),
    exportMany: (args: unknown) => invoke('annotation:exportMany', args),
    labels: {
      get: () => invoke('annotation:labels:get'),
      set: (args: unknown) => invoke('annotation:labels:set', args),
    },
    syncStatus: () => invoke('annotation:syncStatus'),
    syncPreview: () => invoke('annotation:syncPreview'),
    syncNow: () => invoke('annotation:syncNow'),
  },
});
