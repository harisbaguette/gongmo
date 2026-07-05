// 데이터 접근 계층 (Postgres). 클라이언트는 db-client.ts 가 프로덕션(Neon)/테스트(PGlite)로 분기.
import { getClient } from './db-client.js';
import type { IpoRow, ListEntry } from './types.js';

const UTC_NOW = `to_char((now() at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS')`;

// ── 메타 (마지막 수집 시각 등) ─────────────────────────
export async function setMeta(key: string, value: string): Promise<void> {
  const c = await getClient();
  await c.query(
    `INSERT INTO meta(key, value) VALUES($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const c = await getClient();
  const { rows } = await c.query<{ value: string }>('SELECT value FROM meta WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

// ── IPO upsert ─────────────────────────────────────────
/**
 * 리스트에서 얻은 필드로 신규 삽입 또는 변동 필드만 갱신.
 * 확정가·경쟁률·밴드는 한 번 확정되면 유지되는 값 → 목록이 일시적으로 "-"(null)로
 * 오더라도 COALESCE 로 기존 값을 보존(확정가 발표 후 회귀 방지).
 * @returns 이번 호출에서 신규로 삽입되었으면 true (기존 갱신이면 false)
 */
export async function upsertFromList(e: ListEntry): Promise<boolean> {
  const c = await getClient();
  const { rows } = await c.query<{ inserted: boolean }>(
    `INSERT INTO ipos
       (id, name, is_spac, subscribe_start, subscribe_end, confirmed_price,
        band_low, band_high, subscription_rate, underwriter, detail_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       is_spac = EXCLUDED.is_spac,
       subscribe_start = COALESCE(EXCLUDED.subscribe_start, ipos.subscribe_start),
       subscribe_end = COALESCE(EXCLUDED.subscribe_end, ipos.subscribe_end),
       confirmed_price = COALESCE(EXCLUDED.confirmed_price, ipos.confirmed_price),
       band_low = COALESCE(EXCLUDED.band_low, ipos.band_low),
       band_high = COALESCE(EXCLUDED.band_high, ipos.band_high),
       subscription_rate = COALESCE(EXCLUDED.subscription_rate, ipos.subscription_rate),
       underwriter = COALESCE(EXCLUDED.underwriter, ipos.underwriter),
       detail_url = EXCLUDED.detail_url,
       updated_at = ${UTC_NOW}
     RETURNING (xmax = 0) AS inserted`,
    [
      e.id,
      e.name,
      e.isSpac ? 1 : 0,
      e.subscribeStart,
      e.subscribeEnd,
      e.confirmedPrice,
      e.bandLow,
      e.bandHigh,
      e.subscriptionRate,
      e.underwriter,
      e.detailUrl,
    ],
  );
  return rows[0]?.inserted === true;
}

/** 상세에서 얻은 필드 갱신 (null 은 덮어쓰지 않음 — 기존 값 보존) */
export async function updateDetail(
  id: number,
  d: {
    listingDate: string | null;
    institutionalRate: number | null;
    lockupRatio: number | null;
    floatRatio: number | null;
  },
): Promise<void> {
  const c = await getClient();
  await c.query(
    `UPDATE ipos SET
       listing_date = COALESCE($1, listing_date),
       institutional_rate = COALESCE($2, institutional_rate),
       lockup_ratio = COALESCE($3, lockup_ratio),
       float_ratio = COALESCE($4, float_ratio),
       updated_at = ${UTC_NOW}
     WHERE id = $5`,
    [d.listingDate, d.institutionalRate, d.lockupRatio, d.floatRatio, id],
  );
}

// ── 조회 ───────────────────────────────────────────────
interface RawIpo {
  id: number;
  name: string;
  is_spac: number;
  subscribe_start: string | null;
  subscribe_end: string | null;
  listing_date: string | null;
  band_low: number | null;
  band_high: number | null;
  confirmed_price: number | null;
  subscription_rate: number | null;
  institutional_rate: number | null;
  lockup_ratio: number | null;
  float_ratio: number | null;
  underwriter: string | null;
  detail_url: string;
  created_at: string;
  updated_at: string;
}

function toRow(r: RawIpo): IpoRow {
  return {
    id: r.id,
    name: r.name,
    isSpac: (r.is_spac ? 1 : 0) as 0 | 1,
    subscribeStart: r.subscribe_start,
    subscribeEnd: r.subscribe_end,
    listingDate: r.listing_date,
    bandLow: r.band_low,
    bandHigh: r.band_high,
    confirmedPrice: r.confirmed_price,
    subscriptionRate: r.subscription_rate,
    institutionalRate: r.institutional_rate,
    lockupRatio: r.lockup_ratio,
    floatRatio: r.float_ratio,
    underwriter: r.underwriter,
    detailUrl: r.detail_url,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getAllIpos(): Promise<IpoRow[]> {
  const c = await getClient();
  const { rows } = await c.query<RawIpo>(
    'SELECT * FROM ipos ORDER BY subscribe_start DESC NULLS LAST, id DESC',
  );
  return rows.map(toRow);
}

export async function getIpo(id: number): Promise<IpoRow | null> {
  const c = await getClient();
  const { rows } = await c.query<RawIpo>('SELECT * FROM ipos WHERE id = $1', [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

// ── 푸시 구독 ──────────────────────────────────────────
export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(s: StoredSubscription): Promise<void> {
  const c = await getClient();
  await c.query(
    `INSERT INTO push_subscriptions(endpoint, p256dh, auth) VALUES($1, $2, $3)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [s.endpoint, s.keys.p256dh, s.keys.auth],
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const c = await getClient();
  await c.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

export async function getSubscriptions(): Promise<StoredSubscription[]> {
  const c = await getClient();
  const { rows } = await c.query<{ endpoint: string; p256dh: string; auth: string }>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions',
  );
  return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

// ── 알림 중복 방지 ─────────────────────────────────────
export async function wasNotified(ipoId: number, kind: string): Promise<boolean> {
  const c = await getClient();
  const { rows } = await c.query('SELECT 1 AS ok FROM notify_log WHERE ipo_id = $1 AND kind = $2', [
    ipoId,
    kind,
  ]);
  return rows.length > 0;
}

export async function markNotified(ipoId: number, kind: string): Promise<void> {
  const c = await getClient();
  await c.query(
    `INSERT INTO notify_log(ipo_id, kind) VALUES($1, $2)
     ON CONFLICT (ipo_id, kind) DO NOTHING`,
    [ipoId, kind],
  );
}
