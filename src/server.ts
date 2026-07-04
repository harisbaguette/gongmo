// 단일 자기완결 서버: API + 정적 PWA 서빙 + 스케줄러 내장
import express from 'express';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { api } from './routes/api.js';
import { startSchedulers } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../public');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// request_id + 응답시간 구조화 로그
app.use((req, res, next) => {
  const requestId = randomUUID();
  res.setHeader('x-request-id', requestId);
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      JSON.stringify({
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      }),
    );
  });
  next();
});

app.use('/api', api);

// 정적 PWA (service worker 는 캐시 무효화 위해 no-cache)
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, path) => {
      if (path.endsWith('sw.js') || path.endsWith('manifest.json')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(resolve(PUBLIC_DIR, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port} (tz=${config.timezone})`);
  startSchedulers();
});
