// 스크래핑 오케스트레이션: 목록 → 상세 → LLM → DB 적재
import { config } from '../config.js';
import {
  getAllIpos,
  markNotified,
  setMeta,
  updateDetail,
  upsertFromList,
  wasNotified,
} from '../db.js';
import { sendToAll } from '../push.js';
import { delay, fetchEucKr } from './fetch.js';
import { crossCheckFloat, extractFloatByRule, extractFloatRatio } from './llm-float.js';
import { parseDetailHtml } from './parse-detail.js';
import { parseListHtml } from './parse-list.js';
import type { IpoRow, ListEntry } from '../types.js';

export interface ScrapeResult {
  listCount: number;
  newCount: number;
  detailTargets: number;
  detailOk: number;
  detailFail: number;
  floatOk: number;
  floatNull: number;
  /** 기존 값을 그대로 쓴 건수(LLM 호출 안 함) */
  floatReused: number;
  /** 규칙 값과 모델 값이 달라 사람 확인이 필요한 건수 */
  floatMismatch: number;
  /** 시간 예산에 걸려 남기고 종료했는지(남은 건수는 다음 실행에서 이어서 처리) */
  stoppedEarly: boolean;
  remaining: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * 상세 수집 순서 최적화: 상세 데이터(상장일·기관경쟁률·유통물량)가 아직 비어 있는
 * 종목을 먼저 처리해, 배치 상한에 걸려도 신규·미완성 종목이 우선 채워지게 한다.
 */
function prioritizeTargets(entries: ListEntry[], existing: IpoRow[]): ListEntry[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const isIncomplete = (e: ListEntry): boolean => {
    const row = byId.get(e.id);
    if (!row) return true; // 신규 = 최우선
    return row.listingDate == null || row.institutionalRate == null || row.floatRatio == null;
  };
  // 미완성 우선, 그 안에서는 원래 순서(대체로 최신) 유지 — 안정 정렬
  return [...entries].sort((a, b) => Number(isIncomplete(b)) - Number(isIncomplete(a)));
}

/**
 * 신규 등재 종목 알림. 이번 수집에서 처음 나타난 종목을 구독자에게 1건으로 묶어 발송.
 * 종목별 `new:<id>` 로그로 중복 발송을 막는다(재수집·재시작에도 재발송 안 함).
 */
async function notifyNewListings(newEntries: ListEntry[]): Promise<void> {
  const fresh: ListEntry[] = [];
  for (const e of newEntries) {
    if (!(await wasNotified(e.id, `new:${e.id}`))) fresh.push(e);
  }
  if (fresh.length === 0) return;
  // 중복 방지 로그는 발송 성공 여부와 무관하게 먼저 확정(구독자 0명이어도 재발송 방지)
  for (const e of fresh) await markNotified(e.id, `new:${e.id}`);

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
  detailBatch?: number;
  onProgress?: (msg: string) => void;
} = {}): Promise<ScrapeResult> {
  const startedAt = new Date().toISOString();
  const log = opts.onProgress ?? (() => {});

  log('목록 페이지 수집 중…');
  const listHtml = await fetchEucKr(config.scrape.listUrl);
  const entries = parseListHtml(listHtml);
  log(`목록 ${entries.length}건 파싱`);

  // upsert 이전 상태를 읽어 신규/미완성 우선순위 판단에 사용
  const existingBefore = await getAllIpos();

  const newEntries: ListEntry[] = [];
  for (const e of entries) {
    if (await upsertFromList(e)) newEntries.push(e);
  }
  if (newEntries.length > 0) log(`신규 등재 ${newEntries.length}건`);

  // 상세 수집 대상: 미완성 우선 정렬 → 배치 상한(서버리스 300초 대응) 적용
  const ordered = prioritizeTargets(entries, existingBefore);
  const batch = opts.detailBatch ?? config.scrape.detailBatch;
  const capped = opts.detailLimit ? ordered.slice(0, opts.detailLimit) : ordered.slice(0, batch);
  const targets = capped;
  let detailOk = 0;
  let detailFail = 0;
  let floatOk = 0;
  let floatNull = 0;

  // 시간 예산: 넘기면 남은 종목을 다음 실행에 넘기고 정상 종료(수집 기록은 남긴다)
  const deadlineAt = Date.now() + config.scrape.deadlineMs;
  let stoppedEarly = false;
  let processed = 0;
  let floatReused = 0;
  let floatMismatch = 0;

  // 이미 채워진 종목까지 매일 모델에 다시 물어보면 돈·시간만 쓰고 값이 흔들릴 위험만 생긴다.
  // 그래서 모델 호출은 "규칙도 실패하고 기존 값도 없는" 종목에만 남긴다.
  const prevById = new Map(existingBefore.map((r) => [r.id, r]));

  for (let i = 0; i < targets.length; i++) {
    if (Date.now() > deadlineAt) {
      stoppedEarly = true;
      log(`시간 예산 초과 — 남은 ${targets.length - i}건은 다음 실행에서 이어서 처리`);
      break;
    }
    processed++;
    const e = targets[i];
    try {
      await delay();
      const detailHtml = await fetchEucKr(e.detailUrl);
      const detail = parseDetailHtml(detailHtml);
      // 규칙 추출은 공짜(외부 호출 0회, 1ms 미만)이므로 매번 다시 계산한다.
      // 그래야 예전에 잘못 저장된 값도 다음 수집에서 스스로 바로잡힌다.
      const prevFloat = prevById.get(e.id)?.floatRatio ?? null;
      const byRule = detail.floatSectionText
        ? extractFloatByRule(detail.floatSectionText)
        : null;
      // 규칙이 못 찾을 때만 기존 값을 재사용하고, 그것도 없을 때만 모델에 묻는다
      if (byRule == null && prevFloat != null) floatReused++;
      const floatRatio =
        byRule ?? prevFloat ?? (await extractFloatRatio(detail.floatSectionText));

      // 처음 값을 채우는 종목은 모델에게 한 번 되물어 교차 확인한다(서식이 회사마다 달라서).
      // 값은 규칙 쪽을 쓰고, 다르면 기록만 남겨 사람이 확인할 수 있게 한다.
      if (byRule != null && prevFloat == null && detail.floatSectionText) {
        if (await crossCheckFloat(detail.floatSectionText, byRule)) {
          floatMismatch++;
          log(`⚠ ${e.name} 유통물량 교차확인 불일치 — 규칙 ${byRule}% (원문 확인 필요)`);
        }
      }
      if (floatRatio == null) floatNull++;
      else floatOk++;

      await updateDetail(e.id, {
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
  await setMeta('last_scrape_at', finishedAt);
  await setMeta(
    'last_scrape_summary',
    JSON.stringify({
      listCount: entries.length,
      newCount: newEntries.length,
      detailTargets: targets.length,
      detailOk,
      detailFail,
      floatOk,
      floatNull,
      floatReused,
      floatMismatch,
      stoppedEarly,
      remaining: targets.length - processed,
    }),
  );

  return {
    listCount: entries.length,
    newCount: newEntries.length,
    detailTargets: targets.length,
    detailOk,
    detailFail,
    floatOk,
    floatNull,
    floatReused,
    floatMismatch,
    stoppedEarly,
    remaining: targets.length - processed,
    startedAt,
    finishedAt,
  };
}
