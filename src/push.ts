// 웹푸시 (VAPID) 발송
import webpush from 'web-push';
import { config, isPushConfigured } from './config.js';
import { deleteSubscription, getSubscriptions } from './db.js';

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!isPushConfigured()) return false;
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
  );
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** 전체 구독자에게 발송. 만료(410/404) 구독은 자동 정리 */
export async function sendToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!ensureConfigured()) {
    console.warn('[push] VAPID 미설정 — 발송 건너뜀');
    return { sent: 0, failed: 0 };
  }
  const subs = getSubscriptions();
  let sent = 0;
  let failed = 0;
  const data = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          data,
        );
        sent++;
      } catch (err) {
        failed++;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          deleteSubscription(s.endpoint); // 만료 구독 제거
        }
      }
    }),
  );

  return { sent, failed };
}
