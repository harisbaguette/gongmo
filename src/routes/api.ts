// REST API 라우트
import { Router, type Request, type Response } from 'express';
import { config, isCronConfigured, isLlmConfigured, isPushConfigured } from '../config.js';
import {
  deleteSubscription,
  getAllIpos,
  getMeta,
  saveSubscription,
  type StoredSubscription,
} from '../db.js';
import { computeGrade } from '../grade.js';
import { runDailyNotifications, runDeadlineNotifications } from '../scheduler.js';
import { runScrape } from '../scraper/index.js';
import type { IpoWithGrade } from '../types.js';

export const api = Router();

let scraping = false; // 동일 프로세스 내 중복 수집 방지 (서버리스 웜 인스턴스 한정)

/** 관리 엔드포인트 토큰 검증 (수동 새로고침) */
function requireAdmin(req: Request, res: Response): boolean {
  const token = req.header('x-admin-token') ?? (req.query.token as string | undefined);
  if (!config.adminToken || token !== config.adminToken) {
    res
      .status(401)
      .json({ data: null, error: { code: 'UNAUTHORIZED', message: '관리 토큰이 필요합니다.' } });
    return false;
  }
  return true;
}

/**
 * cron 엔드포인트 검증 — `Authorization: Bearer <CRON_SECRET>` 또는 `x-cron-secret` 헤더.
 * Vercel Cron 은 CRON_SECRET 설정 시 Authorization Bearer 를 자동 부착하고,
 * cron-job.org 는 커스텀 Authorization 헤더를 지원한다.
 */
function requireCron(req: Request, res: Response): boolean {
  if (!isCronConfigured()) {
    res
      .status(503)
      .json({ data: null, error: { code: 'CRON_NOT_CONFIGURED', message: 'CRON_SECRET 미설정.' } });
    return false;
  }
  const auth = req.header('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const header = req.header('x-cron-secret') ?? '';
  if (bearer !== config.cronSecret && header !== config.cronSecret) {
    res
      .status(401)
      .json({ data: null, error: { code: 'UNAUTHORIZED', message: 'cron 시크릿이 올바르지 않습니다.' } });
    return false;
  }
  return true;
}

// 전체 공모주 목록 (등급 포함)
api.get('/ipos', async (_req, res) => {
  const rows = await getAllIpos();
  const list: IpoWithGrade[] = rows.map((r) => ({ ...r, grade: computeGrade(r) }));
  res.json({
    data: list,
    meta: {
      total: list.length,
      lastScrapeAt: await getMeta('last_scrape_at'),
      pushConfigured: isPushConfigured(),
      llmConfigured: isLlmConfigured(),
    },
    error: null,
  });
});

// 클라이언트 설정 (VAPID 공개키 등)
api.get('/config', (_req, res) => {
  res.json({
    data: {
      vapidPublicKey: config.vapid.publicKey || null,
      pushEnabled: isPushConfigured(),
    },
    error: null,
  });
});

// 헬스체크
api.get('/health', (_req, res) => {
  res.json({ data: { ok: true, ts: new Date().toISOString() }, error: null });
});

// 푸시 구독 등록
api.post('/subscribe', async (req, res) => {
  const sub = req.body as Partial<StoredSubscription>;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return res
      .status(400)
      .json({ data: null, error: { code: 'VALIDATION_ERROR', message: '유효한 구독 정보가 아닙니다.' } });
  }
  await saveSubscription({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  res.status(201).json({ data: { ok: true }, error: null });
});

// 푸시 구독 해제
api.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    return res
      .status(400)
      .json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'endpoint 가 필요합니다.' } });
  }
  await deleteSubscription(endpoint);
  res.json({ data: { ok: true }, error: null });
});

// 수동 새로고침 (관리 토큰 보호)
api.post('/refresh', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (scraping) {
    return res
      .status(409)
      .json({ data: null, error: { code: 'ALREADY_RUNNING', message: '이미 수집이 진행 중입니다.' } });
  }
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  scraping = true;
  try {
    const result = await runScrape({ detailLimit: limit });
    res.json({ data: result, error: null });
  } catch (err) {
    res
      .status(500)
      .json({ data: null, error: { code: 'SCRAPE_FAILED', message: (err as Error).message } });
  } finally {
    scraping = false;
  }
});

// ── cron 엔드포인트 (외부 스케줄러 전용, CRON_SECRET 보호) ──────────
// 일 1회 수집. Vercel Cron / cron-job.org 는 GET 을 보내므로 GET·POST 모두 허용.
async function cronScrape(req: Request, res: Response): Promise<void> {
  if (!requireCron(req, res)) return;
  if (scraping) {
    res
      .status(409)
      .json({ data: null, error: { code: 'ALREADY_RUNNING', message: '이미 수집이 진행 중입니다.' } });
    return;
  }
  scraping = true;
  try {
    const result = await runScrape();
    res.json({ data: result, error: null });
  } catch (err) {
    res
      .status(500)
      .json({ data: null, error: { code: 'SCRAPE_FAILED', message: (err as Error).message } });
  } finally {
    scraping = false;
  }
}
api.get('/cron/scrape', cronScrape);
api.post('/cron/scrape', cronScrape);

// 아침 정기 알림 (상장일·청약 시작·마감 당일)
async function cronMorning(req: Request, res: Response): Promise<void> {
  if (!requireCron(req, res)) return;
  try {
    const sent = await runDailyNotifications();
    res.json({ data: { sent }, error: null });
  } catch (err) {
    res
      .status(500)
      .json({ data: null, error: { code: 'NOTIFY_FAILED', message: (err as Error).message } });
  }
}
api.get('/cron/notify-morning', cronMorning);
api.post('/cron/notify-morning', cronMorning);

// 오후 마감 임박 알림
async function cronDeadline(req: Request, res: Response): Promise<void> {
  if (!requireCron(req, res)) return;
  try {
    const sent = await runDeadlineNotifications();
    res.json({ data: { sent }, error: null });
  } catch (err) {
    res
      .status(500)
      .json({ data: null, error: { code: 'NOTIFY_FAILED', message: (err as Error).message } });
  }
}
api.get('/cron/notify-deadline', cronDeadline);
api.post('/cron/notify-deadline', cronDeadline);

// /api/* 미매칭 라우트 → JSON 404
api.use((_req, res) => {
  res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: '경로를 찾을 수 없습니다.' } });
});
