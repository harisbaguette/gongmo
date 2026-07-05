// Vercel 서버리스 함수 진입점. vercel.json 의 rewrite(/api/(.*) → /api)로 모든 API 요청이
// 이 함수로 라우팅되고, Express 앱이 원본 경로(/api/...)를 그대로 라우팅한다.
// Express 앱 인스턴스는 그 자체가 (req, res) 핸들러이므로 default export 로 충분하다.
import app from '../src/app.js';

export default app;
