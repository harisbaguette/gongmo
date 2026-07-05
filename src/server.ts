// 로컬 개발/실행 진입점: 공용 Express 앱에 정적 PWA 서빙을 얹고 listen.
// (Vercel 에서는 사용되지 않음 — 정적은 플랫폼이 public/ 을 서빙, API 는 api/index.ts)
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './app.js';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../public');

// 정적 PWA (service worker·manifest 는 캐시 무효화 위해 no-cache)
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, path) => {
      if (path.endsWith('sw.js') || path.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// SPA fallback (쿼리스트링 딥링크 포함)
app.get('*', (_req, res) => {
  res.sendFile(resolve(PUBLIC_DIR, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port} (tz=${config.timezone})`);
  console.log('[server] 스케줄러는 서버리스 전환으로 제거됨 — 수집은 /api/cron/scrape 또는 npm run scrape');
});
