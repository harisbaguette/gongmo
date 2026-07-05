// 환경 변수 로딩 및 검증 — 모든 시크릿은 .env 에서만 온다 (하드코딩 금지)
import 'dotenv/config';

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

export const config = {
  port: num('PORT', 3000),
  adminToken: str('ADMIN_TOKEN'),
  // 스케줄러 엔드포인트(/api/cron/*) 보호용 Bearer 시크릿
  cronSecret: str('CRON_SECRET'),
  timezone: 'Asia/Seoul',

  scrape: {
    cron: str('SCRAPE_CRON', '0 7 * * *'),
    // 서버리스 함수 300초 제한 대응: 상세 요청 간 딜레이 축소(기본 800ms)
    delayMs: num('SCRAPE_DELAY_MS', 800),
    // 1회 호출당 상세+LLM 처리 최대 건수(나머지는 다음 호출에서 이어서 처리)
    detailBatch: num('SCRAPE_DETAIL_BATCH', 80),
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ipo-calculator/1.0 (personal-use)',
    listUrl: 'https://www.38.co.kr/html/fund/index.htm?o=k',
    detailBase: 'https://www.38.co.kr/html/fund/?o=v&no=',
  },

  openRouter: {
    apiKey: str('OPENROUTER_API_KEY'),
    model: str('OPENROUTER_MODEL', 'deepseek/deepseek-chat'),
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  },

  vapid: {
    publicKey: str('VAPID_PUBLIC_KEY'),
    privateKey: str('VAPID_PRIVATE_KEY'),
    subject: str('VAPID_SUBJECT', 'mailto:admin@example.com'),
  },

  notify: {
    hour: num('NOTIFY_HOUR', 8),
    minute: num('NOTIFY_MINUTE', 30),
    deadlineHour: num('NOTIFY_DEADLINE_HOUR', 15),
    deadlineMinute: num('NOTIFY_DEADLINE_MINUTE', 0),
    all: bool('NOTIFY_ALL', false),
  },
};

/** 웹푸시 설정이 유효한지 */
export function isPushConfigured(): boolean {
  return Boolean(config.vapid.publicKey && config.vapid.privateKey);
}

/** OpenRouter 사용 가능 여부 */
export function isLlmConfigured(): boolean {
  return Boolean(config.openRouter.apiKey && config.openRouter.apiKey.startsWith('sk-'));
}

/** cron 시크릿 설정 여부 */
export function isCronConfigured(): boolean {
  return Boolean(config.cronSecret);
}
