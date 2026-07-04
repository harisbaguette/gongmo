// 스크래핑 오케스트레이션: 목록 → 상세 → LLM → DB 적재
import { config } from '../config.js';
import { markNotified, setMeta, updateDetail, upsertFromList, wasNotified } from '../db.js';
import { sendToAll } from '../push.js';
import { delay, fetchEucKr } from './fetch.js';
import { extractFloatRatio } from './llm-float.js';
import { parseDetailHtml } from './parse-detail.js';
import { parseListHtml } from './parse-list.js';
import type { ListEntry } from '../types.js';

export interface ScrapeResult {
  listCount: number;
  newCount: number;
  detailOk: number;
  detailFail: number;
  floatOk: number;
  floatNull: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * 신규 등재 종목 알림. 이번 수집에서 처음 나타난 종목을 구독자에게 1건으로 묶어 발송.
 * 종목별 `new:<id>` 로그로 중복 발송을 막는다(재수집·재시작에도 재발송 안 함).
 */
async function notifyNewListings(newEntries: ListEntry[]): Promise<void> {
  const fresh = newEntries.filter((e) => !wasNotified(e.id, `new:${e.id}`));
  if (fresh.length === 0) return;
  // 중복 방지 로그는 발송 성공 여부와 무관하게 먼저 확정(구독자 0명이어도 재발송 방지)
  for (const e of fresh) markNotified(e.id, `new:${e.id}`);

  const names = fresh
    .slice(0, 3)
    .map((e) => e.name)
    .join(', ');
  const more = fresh.length > 3 ? ` 외 ${fresh.length - 3}건` : '';
  await sendToAll({
    title: '🆕 신규 공모주 등재',
    body:
      fresh.length === 1
        ? `${fresh[0].name} 이(가) 새로 등재되었습니다.`
        : `${names}${more} — 신규 공모주 ${fresh.length}건이 등재되었습니다.`,
    url: '/?filter=upcoming',
    tag: 'new-listing',
  });
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

  const newEntries: ListEntry[] = [];
  for (const e of entries) {
    if (upsertFromList(e)) newEntries.push(e);
  }
  if (newEntries.length > 0) log(`신규 등재 ${newEntries.length}건`);

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

  // 신규 종목 등재 알림(구독자 대상) — 상세 수집까지 끝난 뒤 발송
  try {
    await notifyNewListings(newEntries);
  } catch (err) {
    log(`신규 등재 알림 실패: ${(err as Error).message}`);
  }

  const finishedAt = new Date().toISOString();
  setMeta('last_scrape_at', finishedAt);
  setMeta(
    'last_scrape_summary',
    JSON.stringify({
      listCount: entries.length,
      newCount: newEntries.length,
      detailOk,
      detailFail,
      floatOk,
      floatNull,
    }),
  );

  return {
    listCount: entries.length,
    newCount: newEntries.length,
    detailOk,
    detailFail,
    floatOk,
    floatNull,
    startedAt,
    finishedAt,
  };
}
