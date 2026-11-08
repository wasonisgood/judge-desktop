// 期間內的法條異動比對。
// 規則：期間開始日當時生效的版本為基準；期間內每一次修法，若指定的項或款文字與前一版不同，就是一次異動。
// 比對的單位是「項」或「款」，不是整條，避免只改某一款卻被誤判為整條不變。
import { buildStructure, selectSegment } from './structure';
import type { HistoryArticle, HistoryVersion } from './history';

export interface SegmentRef {
  paragraph?: number;
  item?: number;
}

export interface VersionChange {
  version: HistoryVersion;
  /** 修法前該項或款的文字；修法前沒有此項或款時為 null。 */
  before: string | null;
  /** 修法後該項或款的文字；修法後已刪除時為 null。 */
  after: string | null;
  /** 新增的行（項與款各一行）。 */
  added: string[];
  /** 刪除的行。 */
  removed: string[];
}

export interface PeriodReport {
  /** 期間開始當時生效的版本；沒有指定開始日或找不到時為 null。 */
  baseline: HistoryVersion | null;
  /** 期間內的所有版本（不含基準版）。 */
  versionsInPeriod: HistoryVersion[];
  /** 期間內實際造成該項或款文字改變的修法。 */
  changes: VersionChange[];
  /** 期間內是否有異動。 */
  changed: boolean;
  /** 期間結束時（最後一個版本）該項或款的文字。 */
  endText: string | null;
}

/** 某版本的指定項或款文字。 */
export function segmentOf(version: HistoryVersion, ref: SegmentRef): string | null {
  return selectSegment(buildStructure(version.text.split('\n')), ref.paragraph, ref.item);
}

/** 期間開始日（含）當時生效的版本：日期小於等於 from 的最新版本。 */
export function versionInForce(versions: HistoryVersion[], on: string): HistoryVersion | null {
  let hit: HistoryVersion | null = null;
  for (const v of versions) {
    if (v.date && v.date <= on) hit = v;
  }
  return hit;
}

function lineDiff(prev: string | null, cur: string | null): { added: string[]; removed: string[] } {
  const a = new Set((prev ?? '').split('\n').filter(Boolean));
  const b = new Set((cur ?? '').split('\n').filter(Boolean));
  return {
    added: [...b].filter((l) => !a.has(l)),
    removed: [...a].filter((l) => !b.has(l)),
  };
}

/**
 * 計算某一條（可指定項、款）在期間內的異動。
 * @param from 期間開始（西元 YYYY-MM-DD，不含當日修法）；未指定則從最舊版本開始。
 * @param to 期間結束（西元 YYYY-MM-DD，含當日）；未指定則到最新版本。
 */
export function periodReport(article: HistoryArticle, opts: { from?: string; to?: string } & SegmentRef): PeriodReport {
  const vs = article.versions.filter((v) => v.date !== null);
  const baseline = opts.from ? versionInForce(vs, opts.from) : null;
  const inPeriod = vs.filter(
    (v) => (!opts.from || (v.date as string) > opts.from) && (!opts.to || (v.date as string) <= opts.to),
  );

  const chain = [...(baseline ? [baseline] : []), ...inPeriod];
  const changes: VersionChange[] = [];
  for (let i = 1; i < chain.length; i++) {
    const before = segmentOf(chain[i - 1], opts);
    const after = segmentOf(chain[i], opts);
    if (before === after) continue;
    const d = lineDiff(before, after);
    changes.push({ version: chain[i], before, after, added: d.added, removed: d.removed });
  }
  const last = chain[chain.length - 1];
  return {
    baseline,
    versionsInPeriod: inPeriod,
    changes,
    changed: changes.length > 0,
    endText: last ? segmentOf(last, opts) : null,
  };
}
