# 공모주 계산기 — 단일 컨테이너 (API + PWA + 스케줄러)
FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 / sharp 네이티브 빌드 도구
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 의존성 설치 (레이어 캐시)
COPY package*.json ./
RUN npm ci

# 소스 복사 후 빌드 + 아이콘 생성
COPY . .
RUN npm run build \
  && npm run gen:icons \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# SQLite 데이터 영속화
VOLUME ["/app/data"]

# 헬스체크
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
