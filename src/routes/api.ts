// REST API 라우트
import { Router, type Request, type Response } from 'express';
import { config, isLlmConfigured, isPushConfigured } from '../config.js';
import {
  deleteSubscription,
  getAllIpos,
  getMeta,
  saveSubscription,
  type StoredSubscription,
} from '../db.js';
import { computeGrade } from '../grade.js';
import { runScrape } from '../scraper/index.js';
import type { IpoWithGrade } from '../types.js';

export const api = Router();

let scraping = false; // 중복 수집 방지

/** 관리 엔드포인트 토큰 검증 */
function requireAdmin(req: Request, res: Response): boolean {
  const token = req.header('x-admin-token') ?? (req.query.token as string | undefined);
  if (!config.adminToken || token !== config.adminToken) {
    res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: '관리 토큰이 필요합니다.' } });
    return false;
  }
  return true;
}

// 전체 공모주 목록 (등급 포함)
api.get('/ipos', (_req, res) => {
  const list: IpoWithGrade[] = getAllIpos().map((r) => ({ ...r, grade: computeGrade(r) }));
  res.json({
    data: list,
    meta: {
      total: list.length,
      lastScrapeAt: getMeta('last_scrape_at'),
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
api.post('/subscribe', (req, res) => {
  const sub = req.body as Partial<StoredSubscription>;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return res
      .status(400)
      .json({ data: null, error: { code: 'VALIDATION_ERROR', message: '유효한 구독 정보가 아닙니다.' } });
  }
  saveSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  res.status(201).json({ data: { ok: true }, error: null });
});

// 푸시 구독 해제
api.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) {
    return res
      .status(400)
      .json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'endpoint 가 필요합니다.' } });
  }
  deleteSubscription(endpoint);
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
