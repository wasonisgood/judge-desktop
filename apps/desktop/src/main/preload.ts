// 預載腳本：只暴露必要的 IPC 介面，畫面無法直接取得 Node 能力。
import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  appInfo: () => invoke('app:info'),
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch: Record<string, unknown>) => invoke('settings:set', patch),
    test: () => invoke('ai:test'),
  },
  cache: { clear: () => invoke('cache:clear') },
  search: {
    run: (args: unknown) => invoke('search:run', args),
    screen: (args: unknown) => invoke('search:screen', args),
    onProgress: (cb: (p: { done: number; total: number; id: string }) => void) => {
      ipcRenderer.on('search:progress', (_e, p) => cb(p));
    },
  },
  exportList: (args: unknown) => invoke('export:list', args),
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
});
