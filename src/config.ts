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
    // 시간 예산: 서버리스 함수 상한(300초)에 걸려 통째로 죽으면 수집 기록조차 남지 않는다.
    // 이 시간을 넘기면 남은 종목은 다음 실행에 넘기고 정상 종료한다(미완성 종목 우선 정렬이라 이어서 채워짐).
    deadlineMs: num('SCRAPE_DEADLINE_MS', 240_000),
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ipo-calculator/1.0 (personal-use)',
    listUrl: 'https://www.38.co.kr/html/fund/index.htm?o=k',
    detailBase: 'https://www.38.co.kr/html/fund/?o=v&no=',
  },

  openRouter: {
    apiKey: str('OPENROUTER_API_KEY'),
    // 실측 비교(2026-07-25, 실제 공시 16건×2회 = 32콜, 운영과 동일한 재시도 포함):
    //   amazon/nova-micro-v1     32/32 정답 · $0.000115/건 · 534ms  ← 채택
    //   mistralai/mistral-nemo   32/32 정답 · $0.000053/건 이지만 429(요청 과다) 빈발
    //   deepseek/deepseek-chat   31/32 (매각제한 지분율 오답 1) · $0.000459/건 ← 이전 기본값
    //   deepseek/deepseek-v4-flash 29/32(빈값 3) · $0.000305/건 (프롬프트 개선 후엔 16/16)
    model: str('OPENROUTER_MODEL', 'amazon/nova-micro-v1'),
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    // 한 번의 추출 요청을 기다려 줄 최대 시간(실측 평균 0.6~1.5초라 15초면 넉넉)
    timeoutMs: num('OPENROUTER_TIMEOUT_MS', 15_000),
    // 429(요청 과다)·5xx 뒤 다시 시도하기 전 대기(테스트에서는 짧게 낮춰 쓴다)
    retryDelayMs: num('OPENROUTER_RETRY_MS', 2_000),
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
