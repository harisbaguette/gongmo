// node-cron 스케줄러: 일일 수집 + 일정 알림 (Asia/Seoul 고정)
import cron from 'node-cron';
import { config } from './config.js';
import { getAllIpos, markNotified, wasNotified } from './db.js';
import { computeGrade } from './grade.js';
import { sendToAll } from './push.js';
import { runScrape } from './scraper/index.js';
import type { IpoRow, Verdict } from './types.js';

/** Asia/Seoul 기준 오늘 날짜 'YYYY-MM-DD' */
export function todayKst(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA → YYYY-MM-DD
}

/** 알림 대상 판정: NOTIFY_ALL=true 면 전체, 아니면 퍼펙트/청약 고려만 */
function isNotifyTarget(verdict: Verdict): boolean {
  if (config.notify.all) return true;
  return verdict === '퍼펙트' || verdict === '청약 고려';
}

function label(ipo: IpoRow, verdict: Verdict): string {
  return `${ipo.name} · ${verdict}`;
}

/** 아침 정기 알림: 상장일/청약시작/청약마감 당일 종목 안내 */
export async function runDailyNotifications(today = todayKst()): Promise<number> {
  const ipos = getAllIpos();
  let sent = 0;

  for (const ipo of ipos) {
    const { verdict } = computeGrade(ipo);
    if (!isNotifyTarget(verdict)) continue;

    const jobs: { kind: string; title: string; body: string }[] = [];
    if (ipo.listingDate === today) {
      jobs.push({
        kind: `listing:${today}`,
        title: '📈 오늘 상장',
        body: `${label(ipo, verdict)} — 오늘 상장일입니다.`,
      });
    }
    if (ipo.subscribeStart === today) {
      jobs.push({
        kind: `subStart:${today}`,
        title: '🟢 청약 시작',
        body: `${label(ipo, verdict)} — 오늘 청약이 시작됩니다.`,
      });
    }
    if (ipo.subscribeEnd === today) {
      jobs.push({
        kind: `subEnd:${today}`,
        title: '🟡 청약 마감일',
        body: `${label(ipo, verdict)} — 오늘 청약 마감입니다.`,
      });
    }

    for (const j of jobs) {
      if (wasNotified(ipo.id, j.kind)) continue;
      const r = await sendToAll({ title: j.title, body: j.body, url: ipo.detailUrl, tag: j.kind });
      // 실제 발송을 시도한 경우(성공 또는 실패)에만 발송 기록.
      // VAPID 미설정·구독자 0명(sent=0,failed=0)이면 기록하지 않아 이후 재발송 가능.
      if (r.sent > 0 || r.failed > 0) markNotified(ipo.id, j.kind);
      sent += r.sent;
    }
  }
  return sent;
}

/** 오후 마감 임박 알림: 청약 마감일 당일 종목 */
export async function runDeadlineNotifications(today = todayKst()): Promise<number> {
  const ipos = getAllIpos();
  let sent = 0;
  for (const ipo of ipos) {
    if (ipo.subscribeEnd !== today) continue;
    const { verdict } = computeGrade(ipo);
    if (!isNotifyTarget(verdict)) continue;
    const kind = `deadline:${today}`;
    if (wasNotified(ipo.id, kind)) continue;
    const r = await sendToAll({
      title: '⏰ 청약 마감 임박',
      body: `${label(ipo, verdict)} — 오늘 15시 이후 청약 마감이 임박했습니다.`,
      url: ipo.detailUrl,
      tag: kind,
    });
    // 실제 발송 시도(성공/실패)가 있을 때만 기록 — VAPID 미설정 시 재발송 여지 보존
    if (r.sent > 0 || r.failed > 0) markNotified(ipo.id, kind);
    sent += r.sent;
  }
  return sent;
}

/** 모든 스케줄러 등록 */
export function startSchedulers(): void {
  const tz = config.timezone;

  // 1) 일일 수집
  cron.schedule(
    config.scrape.cron,
    () => {
      console.log(`[cron] 수집 시작 (${new Date().toISOString()})`);
      runScrape({ onProgress: (m) => console.log(`  ${m}`) })
        .then((r) => console.log('[cron] 수집 완료', r))
        .catch((e) => console.error('[cron] 수집 실패', e));
    },
    { timezone: tz },
  );

  // 2) 아침 정기 알림
  const morning = `${config.notify.minute} ${config.notify.hour} * * *`;
  cron.schedule(
    morning,
    () => {
      runDailyNotifications()
        .then((n) => console.log(`[cron] 아침 알림 발송 ${n}건`))
        .catch((e) => console.error('[cron] 아침 알림 실패', e));
    },
    { timezone: tz },
  );

  // 3) 오후 마감 임박 알림
  const deadline = `${config.notify.deadlineMinute} ${config.notify.deadlineHour} * * *`;
  cron.schedule(
    deadline,
    () => {
      runDeadlineNotifications()
        .then((n) => console.log(`[cron] 마감 임박 알림 발송 ${n}건`))
        .catch((e) => console.error('[cron] 마감 임박 알림 실패', e));
    },
    { timezone: tz },
  );

  console.log(
    `[scheduler] 등록됨 — 수집:"${config.scrape.cron}" 아침:"${morning}" 마감:"${deadline}" (${tz})`,
  );
}
