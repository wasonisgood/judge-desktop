// 串流解析 NDJSON：邊讀邊解析，不需把整個回應放進記憶體（模型下載可能有數 GB）。
// 相容 WHATWG ReadableStream（Node 22 的 fetch 回應 body）。

export class NdjsonParseError extends Error {
  constructor(public readonly lineNo: number, public readonly raw: string) {
    super(`NDJSON 第 ${lineNo} 行無法解析`);
  }
}

/** 逐行解析串流；遇到壞行立即拋出 NdjsonParseError。 */
export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onLine: (obj: any) => void,
): Promise<number> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let lineNo = 0;
  let count = 0;
  const handle = (line: string) => {
    lineNo++;
    const t = line.trim();
    if (!t) return;
    let obj: any;
    try {
      obj = JSON.parse(t);
    } catch {
      throw new NdjsonParseError(lineNo, t.slice(0, 80));
    }
    count++;
    onLine(obj);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, idx).replace(/\r$/, ''));
      buf = buf.slice(idx + 1);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) handle(buf);
  return count;
}
