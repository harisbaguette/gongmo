// 스크래핑 오케스트레이션: 목록 → 상세 → LLM → DB 적재
import { config } from '../config.js';
import { setMeta, updateDetail, upsertFromList } from '../db.js';
import { delay, fetchEucKr } from './fetch.js';
import { extractFloatRatio } from './llm-float.js';
import { parseDetailHtml } from './parse-detail.js';
import { parseListHtml } from './parse-list.js';

export interface ScrapeResult {
  listCount: number;
  detailOk: number;
  detailFail: number;
  floatOk: number;
  floatNull: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * 전체 수집 1회.
 * @param opts.detailLimit 상세 수집 개수 제한 (테스트/부분 수집용, 미지정 시 전체)
 * @param opts.onProgress 진행 콜백
 */
export async function runScrape(opts: {
  detailLimit?: number;
  onProgress?: (msg: string) => void;
} = {}): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const log = opts.onProgress ?? (() => {});

  log('목록 페이지 수집 중…');
  const listHtml = await fetchEucKr(config.scrape.listUrl);
  const entries = parseListHtml(listHtml);
  log(`목록 ${entries.length}건 파싱`);

  for (const e of entries) upsertFromList(e);

  const targets = opts.detailLimit ? entries.slice(0, opts.detailLimit) : entries;
  let detailOk = 0;
  let detailFail = 0;
  let floatOk = 0;
  let floatNull = 0;

  for (let i = 0; i < targets.length; i++) {
    const e = targets[i];
    try {
      await delay();
      const detailHtml = await fetchEucKr(e.detailUrl);
      const detail = parseDetailHtml(detailHtml);
      const floatRatio = await extractFloatRatio(detail.floatSectionText);
      if (floatRatio == null) floatNull++;
      else floatOk++;

      updateDetail(e.id, {
        listingDate: detail.listingDate,
        institutionalRate: detail.institutionalRate,
        lockupRatio: detail.lockupRatio,
        floatRatio,
      });
      detailOk++;
      log(`[${i + 1}/${targets.length}] ${e.name} 상세 완료 (유통물량 ${floatRatio ?? '미확인'})`);
    } catch (err) {
      detailFail++;
      log(`[${i + 1}/${targets.length}] ${e.name} 상세 실패: ${(err as Error).message}`);
    }
  }

  const finishedAt = new Date().toISOString();
  setMeta('last_scrape_at', finishedAt);
  setMeta(
    'last_scrape_summary',
    JSON.stringify({ listCount: entries.length, detailOk, detailFail, floatOk, floatNull }),
  );

  return {
    listCount: entries.length,
    detailOk,
    detailFail,
    floatOk,
    floatNull,
    startedAt,
    finishedAt,
  };
}
