// DB 클라이언트 추상화: 프로덕션은 Neon(@neondatabase/serverless HTTP 드라이버),
// 테스트·로컬 개발은 PGlite(인프로세스 Postgres). 두 경로 모두 동일한 SqlClient 계약을 만족한다.
import { neon } from '@neondatabase/serverless';

/** 모든 데이터 접근이 사용하는 최소 계약 — pg.Pool / PGlite 와 호환되는 `{ rows }` 반환 */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

// ── 스키마 (Postgres 방언, idempotent) ────────────────────
// created_at/updated_at 은 프론트엔드(app.js isNew)가 'YYYY-MM-DD HH:MM:SS'(UTC) 문자열을
// 파싱하므로, 기존 SQLite datetime('now') 와 동일 포맷을 유지하기 위해 TEXT + to_char 로 둔다.
const UTC_NOW = `to_char((now() at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS')`;

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS ipos (
     id                 INTEGER PRIMARY KEY,
     name               TEXT NOT NULL,
     is_spac            SMALLINT NOT NULL DEFAULT 0,
     subscribe_start    TEXT,
     subscribe_end      TEXT,
     listing_date       TEXT,
     band_low           INTEGER,
     band_high          INTEGER,
     confirmed_price    INTEGER,
     subscription_rate  DOUBLE PRECISION,
     institutional_rate DOUBLE PRECISION,
     lockup_ratio       DOUBLE PRECISION,
     float_ratio        DOUBLE PRECISION,
     underwriter        TEXT,
     detail_url         TEXT NOT NULL,
     created_at         TEXT NOT NULL DEFAULT ${UTC_NOW},
     updated_at         TEXT NOT NULL DEFAULT ${UTC_NOW}
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ipos_subscribe_start ON ipos(subscribe_start)`,
  `CREATE INDEX IF NOT EXISTS idx_ipos_listing_date ON ipos(listing_date)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
     endpoint    TEXT PRIMARY KEY,
     p256dh      TEXT NOT NULL,
     auth        TEXT NOT NULL,
     created_at  TEXT NOT NULL DEFAULT ${UTC_NOW}
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS notify_log (
     ipo_id  INTEGER NOT NULL,
     kind    TEXT NOT NULL,
     sent_at TEXT NOT NULL DEFAULT ${UTC_NOW},
     PRIMARY KEY (ipo_id, kind)
   )`,
];

/** 스키마 초기화 — 각 문(statement)을 순차 실행 (HTTP 드라이버는 문당 1요청) */
export async function initSchema(client: SqlClient): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.query(stmt);
  }
}

// ── 드라이버 생성 ─────────────────────────────────────────
function createNeonClient(url: string): SqlClient {
  const sql = neon(url);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      // neon HTTP 드라이버(v0.10): sql(text, params, opts) 형태로 파라미터 쿼리 실행.
      // fullResults 로 { rows, ... } 객체 반환(컬럼명 키 row 객체).
      const res = await sql(text, params as unknown[], { fullResults: true });
      return { rows: res.rows as T[] };
    },
  };
}

async function createPgliteClient(dataDir?: string): Promise<SqlClient> {
  // 변수 specifier 로 동적 import → Vercel 함수 번들(nft) 추적에서 제외(프로덕션 미포함).
  const pkg = '@electric-sql/pglite';
  const mod = (await import(pkg)) as { PGlite: new (dir?: string) => PgliteInstance };
  const pg = new mod.PGlite(dataDir);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query(text, params as unknown[]);
      return { rows: res.rows as T[] };
    },
  };
}

interface PgliteInstance {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

// ── 싱글턴 + 테스트 주입 ──────────────────────────────────
let clientPromise: Promise<SqlClient> | null = null;

async function init(): Promise<SqlClient> {
  const url = process.env.DATABASE_URL;
  const driver = (process.env.DB_DRIVER ?? '').toLowerCase();
  const onVercel = Boolean(process.env.VERCEL);

  let client: SqlClient;
  if (driver === 'pglite' || driver === 'memory') {
    // 명시적 PGlite (테스트/강제 로컬)
    client = await createPgliteClient(driver === 'memory' ? undefined : process.env.PGLITE_DIR ?? './data/pglite');
  } else if (url) {
    client = createNeonClient(url);
  } else if (!onVercel) {
    // 로컬 개발 zero-config: DATABASE_URL 없으면 파일 기반 PGlite 로 동작
    client = await createPgliteClient(process.env.PGLITE_DIR ?? './data/pglite');
  } else {
    throw new Error('DATABASE_URL 환경변수가 필요합니다. (Neon 연결 문자열)');
  }
  await initSchema(client);
  return client;
}

/** 데이터 접근 함수가 사용하는 준비 완료 클라이언트(싱글턴, 스키마 초기화 포함) */
export function getClient(): Promise<SqlClient> {
  if (!clientPromise) clientPromise = init();
  return clientPromise;
}

/** 테스트 전용: 인메모리 PGlite 클라이언트 생성(스키마 초기화 포함) */
export async function createTestClient(): Promise<SqlClient> {
  const client = await createPgliteClient(undefined); // 인메모리
  await initSchema(client);
  return client;
}

/** 테스트 전용: 클라이언트 주입 */
export function __setClientForTest(client: SqlClient): void {
  clientPromise = Promise.resolve(client);
}

/** 테스트 전용: 싱글턴 리셋 */
export function __resetClientForTest(): void {
  clientPromise = null;
}
