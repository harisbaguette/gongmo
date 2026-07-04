// HTTP 취득 + EUC-KR → UTF-8 디코딩
import iconv from 'iconv-lite';
import { config } from '../config.js';

/** 38.co.kr 은 EUC-KR 인코딩 → 바이트로 받아 iconv 로 디코딩 */
export async function fetchEucKr(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': config.scrape.userAgent,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buf, 'euc-kr');
}

/** 사이트 예의: 요청 간 딜레이 */
export function delay(ms = config.scrape.delayMs): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
