# 📊 공모주 계산기

가족과 함께 쓰는 공모주 청약 진입 판단 PWA. 매일 [38커뮤니케이션(38.co.kr)](https://www.38.co.kr/html/fund/index.htm?o=k)에서 공모주 정보를 수집해 지표별 등급을 계산하고, 진입 여부(**퍼펙트 / 청약 고려 / 진입 X / 판정 대기**)를 자동 판정합니다. 청약·상장 일정에 맞춰 웹푸시 알림을 보냅니다.

단일 Node 서버 하나가 **API + 정적 PWA 서빙 + 스케줄러**를 모두 담당합니다. 외부 DB·큐 없이 SQLite 파일 하나로 동작합니다.

---

## 주요 기능

- **자동 수집**: 매일 정해진 시각(기본 07:00 KST)에 목록·상세 페이지를 스크래핑. 수동 새로고침 버튼도 제공.
- **등급 계산**: 기관경쟁률·청약경쟁률·의무보유확약·유통가능물량·확정공모가를 상/중/하로 등급화하고 최종 진입 판정.
- **유통가능물량 추출**: 형식이 들쭉날쭉한 "공모후 유통가능 물량" 표는 OpenRouter LLM으로 비율(%)을 추출(실패 시 "미확인").
- **웹푸시 알림**: 상장일·청약 시작/마감일 아침 알림 + 마감 임박(오후) 알림.
- **PWA**: 홈 화면 설치, 오프라인 캐시, 다크모드, 모바일 우선 반응형 한국어 UI.

---

## 등급·판정 기준

| 지표 | 상 | 중 | 하 |
|------|----|----|----|
| 기관경쟁률 | > 1100 | 600 ~ 1100 | < 600 |
| 청약경쟁률 | > 900 | 286.4 ~ 900 | < 286.4 |
| 의무보유확약 | > 15% | 7.5 ~ 15% | < 7.5% |
| 유통가능물량 | < 31% | 31 ~ 43.85% | > 43.85% |
| 확정공모가 | 밴드 상단 이상 | 밴드 사이 | 밴드 하단 이하 |

**진입 판정**
- **퍼펙트**: 확정가=상 · 기관=상 · 의무보유=상 · 유통물량=상
- **청약 고려**: 확정가=상 · 기관=상 · 의무보유∈{상,중} · 유통물량∈{상,중}
- **진입 X**: 확정공모가 등급이 '상'이 아니면 무조건 진입 X. 그 외 조건 미달도 진입 X.
- **판정 대기**: 경쟁률·확정공모가 등 핵심 데이터가 아직 미발표.

---

## 빠른 시작 (로컬)

```bash
# 1) 의존성 설치
npm install

# 2) 환경 변수 준비
cp .env.example .env
#  - OPENROUTER_API_KEY 입력 (유통물량 추출용)
#  - ADMIN_TOKEN 을 긴 임의 문자열로 변경

# 3) 웹푸시 키 생성 → 출력값을 .env 의 VAPID_* 에 붙여넣기
npm run gen:vapid

# 4) PWA 아이콘 생성 (public/icons/*.png)
npm run gen:icons

# 5) 개발 서버 실행 (http://localhost:3000)
npm run dev

# 6) 최초 데이터 수집 (별도 터미널) — 앱 화면의 ↻ 새로고침 버튼으로도 가능
npm run scrape          # 전체 수집
npm run scrape 5        # 상세는 앞 5건만 (빠른 테스트)
```

첫 실행 후 화면의 **↻ 새로고침** 버튼을 누르면 관리 토큰(`ADMIN_TOKEN`)을 물어봅니다. 한 번 입력하면 브라우저에 저장됩니다.

### 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | 개발 서버(자동 리로드) |
| `npm run build` | TypeScript → `dist/` 빌드 |
| `npm start` | 빌드 산출물 실행 |
| `npm run scrape [N]` | 수동 수집(N: 상세 개수 제한) |
| `npm run gen:vapid` | VAPID 키쌍 생성 |
| `npm run gen:icons` | 아이콘 PNG 생성 |
| `npm run lint` / `npm run typecheck` / `npm test` | 품질 게이트 |

---

## 환경 변수 (.env)

| 키 | 기본값 | 설명 |
|----|--------|------|
| `PORT` | 3000 | 서버 포트 |
| `ADMIN_TOKEN` | — | 수동 새로고침 등 관리 엔드포인트 보호 토큰 |
| `SCRAPE_CRON` | `0 7 * * *` | 수집 스케줄(Asia/Seoul) |
| `SCRAPE_DELAY_MS` | 1500 | 상세 요청 간 딜레이 |
| `OPENROUTER_API_KEY` | — | 유통물량 추출용(없으면 해당 값 null) |
| `OPENROUTER_MODEL` | `deepseek/deepseek-chat` | 사용 모델 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — | 웹푸시 키(`gen:vapid`) |
| `VAPID_SUBJECT` | — | `mailto:본인이메일` |
| `NOTIFY_HOUR` / `NOTIFY_MINUTE` | 8 / 30 | 아침 알림 시각 |
| `NOTIFY_DEADLINE_HOUR` / `NOTIFY_DEADLINE_MINUTE` | 15 / 0 | 마감 임박 알림 시각 |
| `NOTIFY_ALL` | false | true면 전체 종목, false면 퍼펙트/청약 고려만 알림 |

> ⚠️ `.env` 는 **절대 커밋하지 마세요**(`.gitignore`에 포함됨). 시크릿은 오직 `.env` 또는 배포 플랫폼의 환경 변수 설정에만 둡니다.

---

## API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/ipos` | 전체 공모주 + 등급/판정 |
| GET | `/api/config` | VAPID 공개키·푸시 활성화 여부 |
| GET | `/api/health` | 헬스체크 |
| POST | `/api/subscribe` | 푸시 구독 등록 |
| POST | `/api/unsubscribe` | 푸시 구독 해제 |
| POST | `/api/refresh` | 수동 수집(헤더 `x-admin-token` 필요) |

응답은 `{ data, meta?, error }` 표준 형식입니다.

---

## 배포 옵션

`.env` 의 값들은 각 플랫폼의 **환경 변수/시크릿**으로 등록합니다(이미지에 굽지 않습니다).

### 1) 가정용 PC + Cloudflare Tunnel (권장 — 무료·상시)

집에 있는 PC에서 상시 실행하고 Cloudflare Tunnel로 외부에서 접속. 포트 개방 불필요.

```bash
# 서버 실행 (PC에서 상시)
npm run build && npm start
#   또는 pm2 로 상시화:  npx pm2 start dist/server.js --name ipo

# Cloudflare Tunnel (cloudflared 설치 후)
cloudflared tunnel --url http://localhost:3000
#   → https://xxxx.trycloudflare.com 주소가 발급됨(가족에게 공유)
#   고정 도메인이 필요하면 named tunnel + 본인 도메인 연결
```

Docker로 상시화:

```bash
docker build -t ipo-calc .
docker run -d --name ipo-calc -p 3000:3000 \
  --env-file .env -v ipo-data:/app/data --restart unless-stopped ipo-calc
```

### 2) Fly.io

```bash
fly launch --no-deploy            # fly.toml 생성 (내부 포트 3000)
fly volumes create ipo_data --size 1
#   fly.toml 의 [mounts] 로 /app/data 에 볼륨 연결
fly secrets set OPENROUTER_API_KEY=... ADMIN_TOKEN=... \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:...
fly deploy
```

### 3) Railway

- GitHub 저장소 연결 → Dockerfile 자동 감지 배포.
- **Variables** 에 `.env` 값들 등록.
- **Volume** 을 `/app/data` 에 마운트(SQLite 영속화).

> 어느 플랫폼이든 웹푸시는 **HTTPS**에서만 동작합니다. 세 옵션 모두 HTTPS를 제공합니다.

---

## 가족과 함께 쓰기

1. 발급된 주소(예: Cloudflare Tunnel URL)를 가족에게 공유합니다.
2. 각자 스마트폰 브라우저(안드로이드는 Chrome, 아이폰은 Safari)로 접속 → **홈 화면에 추가**로 앱 설치.
3. 앱에서 **🔔 알림** 버튼을 눌러 푸시 권한을 허용하면, 청약·상장 일정 알림을 각 기기에서 받습니다.
4. 데이터 수집은 서버에서 자동(매일)으로 이뤄지므로 가족은 열어보기만 하면 됩니다.

---

## 위젯에 대한 안내

웹 표준 PWA의 홈 화면 **위젯**은 아직 플랫폼 지원이 제한적입니다(Windows 11 등 일부만). 그래서 이 앱은 위젯 대신 **앱 바로가기(App Shortcuts)** 와 **앱 아이콘 배지(Badging API)** 로 대체했습니다 — 오늘 청약/상장 예정인 추천 종목 수가 앱 아이콘에 배지로 표시됩니다.

---

## 품질·테스트

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # 파서(고정 HTML fixture) + 등급 로직 단위테스트
```

`test/fixtures/` 의 실제 38.co.kr HTML(EUC-KR)로 파서를 검증합니다.

---

## 데이터 출처·면책

데이터 출처는 38커뮤니케이션(38.co.kr)이며, 수집은 개인적 용도로 요청 간 딜레이를 두고 최소한으로 수행합니다. 본 앱의 등급·판정은 **참고용**이며, 투자 판단과 그 결과의 책임은 전적으로 이용자 본인에게 있습니다.
