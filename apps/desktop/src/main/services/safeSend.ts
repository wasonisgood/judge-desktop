// 安全送出進度（v3.6.0）：視窗已關閉或渲染程序已銷毀時，送出會拋例外；進度只是顯示用，失敗不能中止工作。
import type { WebContents } from 'electron';

export function safeSend(sender: WebContents | null | undefined, channel: string, payload: unknown): void {
  if (!sender) return;
  try {
    if (!sender.isDestroyed()) sender.send(channel, payload);
  } catch {
    /* 視窗在送出瞬間關閉：忽略，工作照常進行 */
  }
}
