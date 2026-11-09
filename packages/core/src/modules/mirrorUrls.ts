// 鏡像網址建立：Firebase Storage 的公開下載網址格式（唯讀，由 storage.rules 允許 judge-desktop/ 前綴）。
export const FIREBASE_BUCKET = 'judge-remote-mcp-2026.firebasestorage.app';

export function firebaseMirrorUrl(objectPath: string, bucket: string = FIREBASE_BUCKET): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;
}

/** 物件路徑：judge-desktop/<tag>/<檔名>（版本化） */
export function releaseObjectPath(tag: string, assetName: string): string {
  return `judge-desktop/${tag}/${assetName}`;
}

/** 物件路徑：judge-desktop/latest/<檔名>（固定名稱，給自動更新用） */
export function latestObjectPath(assetName: string): string {
  return `judge-desktop/latest/${assetName}`;
}
