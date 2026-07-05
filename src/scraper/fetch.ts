// HTTP 취득 + EUC-KR → UTF-8 디코딩
import https from 'node:https';
import iconv from 'iconv-lite';
import { config } from '../config.js';

/**
 * 38.co.kr 은 EUC-KR 인코딩 + 약한 Diffie-Hellman 파라미터(레거시 TLS)를 사용한다.
 * Node 22(OpenSSL 3.x)의 기본 보안레벨은 이를 거부(ERR_SSL_DH_KEY_TOO_SMALL)하므로,
 * SECLEVEL 을 낮춘 커스텀 https 요청으로 바이트를 받아 iconv 로 디코딩한다.
 * (undici 내장 fetch 는 TLS ciphers 를 요청 단위로 지정할 수 없어 https 모듈을 사용)
 */
export function fetchEucKr(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': config.scrape.userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
        // 레거시 약한 DH 키 허용 (38.co.kr TLS 대응)
        ciphers: 'DEFAULT:@SECLEVEL=0',
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'euc-kr')));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout for ${url}`)));
  });
}

/** 사이트 예의: 요청 간 딜레이 */
export function delay(ms = config.scrape.delayMs): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
