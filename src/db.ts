// better-sqlite3 기반 데이터 계층
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IpoRow, ListEntry } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../data/ipo.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS ipos (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL,
    is_spac           INTEGER NOT NULL DEFAULT 0,
    subscribe_start   TEXT,
    subscribe_end     TEXT,
    listing_date      TEXT,
    band_low          INTEGER,
    band_high         INTEGER,
    confirmed_price   INTEGER,
    subscription_rate REAL,
    institutional_rate REAL,
    lockup_ratio      REAL,
    float_ratio       REAL,
    underwriter       TEXT,
    detail_url        TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_ipos_subscribe_start ON ipos(subscribe_start);
  CREATE INDEX IF NOT EXISTS idx_ipos_listing_date ON ipos(listing_date);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint    TEXT PRIMARY KEY,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- 동일 알림 중복 발송 방지 기록
  CREATE TABLE IF NOT EXISTS notify_log (
    ipo_id  INTEGER NOT NULL,
    kind    TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (ipo_id, kind)
  );
`);

// ── 메타 (마지막 수집 시각 등) ─────────────────────────
export function setMeta(key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getMeta(key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

// ── IPO upsert ─────────────────────────────────────────
/**
 * 리스트에서 얻은 필드로 신규 삽입 또는 변동 필드만 갱신.
 * @returns 이번 호출에서 신규로 삽입되었으면 true (기존 갱신이면 false)
 */
export function upsertFromList(e: ListEntry): boolean {
  const exists = db.prepare('SELECT id FROM ipos WHERE id = ?').get(e.id);
  if (exists) {
    // 확정가·경쟁률·밴드는 한 번 확정되면 유지되는 값 → 목록이 일시적으로 "-"(null)로
    // 오더라도 기존 값을 지우지 않도록 COALESCE 로 보존(확정가 발표 후 회귀 방지).
    db.prepare(
      `UPDATE ipos SET
        name = ?, is_spac = ?,
        subscribe_start = COALESCE(?, subscribe_start),
        subscribe_end = COALESCE(?, subscribe_end),
        confirmed_price = COALESCE(?, confirmed_price),
        band_low = COALESCE(?, band_low),
        band_high = COALESCE(?, band_high),
        subscription_rate = COALESCE(?, subscription_rate),
        underwriter = COALESCE(?, underwriter),
        detail_url = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
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
      e.id,
    );
    return false;
  } else {
    db.prepare(
      `INSERT INTO ipos
        (id, name, is_spac, subscribe_start, subscribe_end, confirmed_price,
         band_low, band_high, subscription_rate, underwriter, detail_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
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
    );
    return true;
  }
}

/** 상세에서 얻은 필드 갱신 (null 은 덮어쓰지 않음 — 기존 값 보존) */
export function updateDetail(
  id: number,
  d: {
    listingDate: string | null;
    institutionalRate: number | null;
    lockupRatio: number | null;
    floatRatio: number | null;
  },
): void {
  db.prepare(
    `UPDATE ipos SET
      listing_date = COALESCE(?, listing_date),
      institutional_rate = COALESCE(?, institutional_rate),
      lockup_ratio = COALESCE(?, lockup_ratio),
      float_ratio = COALESCE(?, float_ratio),
      updated_at = datetime('now')
     WHERE id = ?`,
  ).run(d.listingDate, d.institutionalRate, d.lockupRatio, d.floatRatio, id);
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

export function getAllIpos(): IpoRow[] {
  const rows = db
    .prepare('SELECT * FROM ipos ORDER BY subscribe_start DESC, id DESC')
    .all() as RawIpo[];
  return rows.map(toRow);
}

export function getIpo(id: number): IpoRow | null {
  const r = db.prepare('SELECT * FROM ipos WHERE id = ?').get(id) as RawIpo | undefined;
  return r ? toRow(r) : null;
}

// ── 푸시 구독 ──────────────────────────────────────────
export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function saveSubscription(s: StoredSubscription): void {
  db.prepare(
    `INSERT INTO push_subscriptions(endpoint, p256dh, auth) VALUES(?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(s.endpoint, s.keys.p256dh, s.keys.auth);
}

export function deleteSubscription(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function getSubscriptions(): StoredSubscription[] {
  const rows = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as {
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

// ── 알림 중복 방지 ─────────────────────────────────────
export function wasNotified(ipoId: number, kind: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM notify_log WHERE ipo_id = ? AND kind = ?').get(ipoId, kind),
  );
}

export function markNotified(ipoId: number, kind: string): void {
  db.prepare('INSERT OR IGNORE INTO notify_log(ipo_id, kind) VALUES(?, ?)').run(ipoId, kind);
}
