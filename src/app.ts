// 공용 Express 앱: API 라우트 + 구조화 로깅. 정적 서빙·리슨은 실행 환경(로컬/Vercel)이 담당.
// - Vercel: api/index.ts 가 이 앱을 서버리스 함수로 export (정적은 플랫폼이 public/ 에서 서빙)
// - 로컬:   src/server.ts 가 이 앱에 정적 서빙을 얹고 listen
import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { api } from './routes/api.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // request_id + 응답시간 구조화 로그
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    // 라우터 마운트 후 req.path 가 상대경로로 바뀌므로 요청 시점의 전체 경로를 캡처
    const path = req.originalUrl.split('?')[0];
    res.on('finish', () => {
      console.log(
        JSON.stringify({
          requestId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        }),
      );
    });
    next();
  });

  app.use('/api', api);
  return app;
}

const app = createApp();
export default app;
