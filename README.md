# 📊 공모주 계산기

가족과 함께 쓰는 공모주 청약 진입 판단 PWA. 매일 [38커뮤니케이션(38.co.kr)](https://www.38.co.kr/html/fund/index.htm?o=k)에서 공모주 정보를 수집해 지표별 등급을 계산하고, 진입 여부(**퍼펙트 / 청약 고려 / 진입 X / 판정 대기**)를 자동 판정합니다. 청약·상장 일정에 맞춰 웹푸시 알림을 보냅니다.

**배포 스택: [Neon](https://neon.tech)(서버리스 Postgres) + [Vercel](https://vercel.com)(서버리스 함수·정적 호스팅).** 정적 PWA(`public/`)는 Vercel이 서빙하고, API·수집·알림은 서버리스 함수(`api/index.ts`, Express 앱)가 담당합니다. 상시 프로세스가 없으므로 정확한 시각 알림은 외부 스케줄러가 보호된 cron 엔드포인트를 호출하는 구조입니다. 로컬 개발은 `DATABASE_URL` 없이도 인프로세스 Postgres(PGlite)로 즉시 동작합니다.

---

## 주요 기능

- **자동 수집**: 외부 스케줄러(cron-job.org)가 매일 정해진 시각(예: 07:00 KST)에 보호된 수집 엔드포인트를 호출해 목록·상세 페이지를 스크래핑. 수동 새로고침 버튼도 제공.
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
#  - ADMIN_TOKEN / CRON_SECRET 을 긴 임의 문자열로 변경
#  - DATABASE_URL 은 비워두면 로컬은 PGlite 파일(data/pglite)로 자동 동작

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

로컬 `npm run dev`는 상시 프로세스가 아니므로 자동 스케줄러가 없습니다. 수집은 위 `npm run scrape` 또는 앱 화면의 **↻ 새로고침** 버튼(관리 토큰 `ADMIN_TOKEN` 입력, 브라우저에 저장됨)으로 실행합니다.

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
| `DATABASE_URL` | — | Neon Postgres 연결 문자열. 비우면 로컬은 PGlite 파일로 자동 동작 |
| `DB_DRIVER` | (자동) | `neon`/`pglite`/`memory` 강제 선택(선택). 기본은 `DATABASE_URL` 유무로 판단 |
| `PORT` | 3000 | 로컬 서버 포트 |
| `ADMIN_TOKEN` | — | 수동 새로고침 등 관리 엔드포인트 보호 토큰 |
| `CRON_SECRET` | — | cron 엔드포인트(`/api/cron/*`) 보호 Bearer 시크릿 |
| `SCRAPE_CRON` | `0 7 * * *` | 수집 스케줄(참고/로컬용 — 서버리스는 외부 스케줄러가 시각 결정) |
| `SCRAPE_DELAY_MS` | 800 | 상세 요청 간 딜레이(서버리스 300초 제한 대응) |
| `SCRAPE_DETAIL_BATCH` | 80 | 1회 호출당 상세+LLM 처리 최대 건수(초과분은 다음 호출에서 이어서) |
| `OPENROUTER_API_KEY` | — | 유통물량 추출용(없으면 해당 값 null) |
| `OPENROUTER_MODEL` | `deepseek/deepseek-chat` | 사용 모델 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — | 웹푸시 키(`gen:vapid`) |
| `VAPID_SUBJECT` | — | `mailto:본인이메일` |
| `NOTIFY_HOUR` / `NOTIFY_MINUTE` | 8 / 30 | 아침 알림 시각(외부 스케줄러 등록 시각과 맞춤) |
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
| GET·POST | `/api/cron/scrape` | 일 1회 수집(헤더 `Authorization: Bearer <CRON_SECRET>`) |
| GET·POST | `/api/cron/notify-morning` | 아침 알림 발송(상장·청약 시작·마감 당일) |
| GET·POST | `/api/cron/notify-deadline` | 마감 임박 알림 발송 |

응답은 `{ data, meta?, error }` 표준 형식입니다. `/api/cron/*` 는 `CRON_SECRET` Bearer(또는 `x-cron-secret` 헤더)로 보호되며, 외부 스케줄러 전용입니다.

---

## 배포 (Neon + Vercel)

> ⚠️ 아래 절차는 코드·설정 기준으로 작성되었으며, **실제 Neon/Vercel 계정으로의 배포 스모크 테스트는 수행되지 않았습니다(미실측)**. 로컬 검증(타입체크·린트·테스트 57건·로컬 서버 부팅·API/cron 응답)까지만 완료된 상태입니다.

시크릿은 이미지·저장소에 굽지 않고 **Vercel 환경 변수**로만 등록합니다.

### 1) Neon 프로젝트 생성 → DATABASE_URL

1. [neon.tech](https://neon.tech) 가입 → 무료 프로젝트 생성(리전은 한국과 가까운 곳, 예: Singapore).
2. 대시보드의 **Connection string**(pooled, `-pooler` 포함) 복사 → 이 값이 `DATABASE_URL` 입니다.
   - 형식: `postgresql://user:pass@ep-xxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require`
3. **스키마 초기화는 자동입니다.** 함수 콜드스타트 시 `CREATE TABLE IF NOT EXISTS` 가 idempotent 하게 실행되므로 별도 마이그레이션 명령이 필요 없습니다. (수동으로 미리 만들고 싶으면 `src/db-client.ts` 의 `SCHEMA_STATEMENTS` 를 Neon SQL Editor 에 붙여넣어 실행)

### 2) Vercel 프로젝트 연결 + 환경 변수

```bash
npm i -g vercel
vercel link                     # GitHub 저장소 또는 로컬 폴더 연결

# 환경 변수 등록 (Production/Preview 모두)
vercel env add DATABASE_URL
vercel env add OPENROUTER_API_KEY
vercel env add OPENROUTER_MODEL          # (선택, 기본 deepseek/deepseek-chat)
vercel env add VAPID_PUBLIC_KEY
vercel env add VAPID_PRIVATE_KEY
vercel env add VAPID_SUBJECT             # mailto:본인이메일
vercel env add CRON_SECRET               # 긴 임의 문자열 (cron 보호 + Vercel Cron 자동 인증)
vercel env add ADMIN_TOKEN               # 수동 새로고침용

vercel deploy --prod
```

- `public/` 는 Vercel 이 정적 서빙, `/api/*` 는 `api/index.ts`(Express 앱) 서버리스 함수가 처리합니다(`vercel.json` 의 rewrite).
- 함수 `maxDuration` 은 300초로 설정되어 있습니다(`vercel.json`). 수집은 1회 호출당 `SCRAPE_DETAIL_BATCH` 건까지만 상세를 처리하고, 초과분은 다음 호출에서 미완성 종목 우선으로 이어서 채웁니다.
- 웹푸시는 **HTTPS** 에서만 동작하며 Vercel 은 기본 HTTPS 를 제공합니다.

### 3) 정확한 시각 알림 = 외부 스케줄러(cron-job.org)

Vercel Hobby 플랜의 Cron 은 **하루 1회 + 시각 부정확**(지정 시각의 약 1시간 창 내 임의 실행) 제약이 있습니다. 따라서 정확한 시각의 알림은 [cron-job.org](https://cron-job.org)(무료) 같은 외부 스케줄러가 보호된 엔드포인트를 호출하도록 등록합니다. 각 잡은 **Authorization 헤더**에 `Bearer <CRON_SECRET>` 을 넣습니다.

| 잡 | 시각(KST) | URL(GET) | 헤더 |
|----|-----------|----------|------|
| 수집 | 매일 07:00 | `https://<앱>/api/cron/scrape` | `Authorization: Bearer <CRON_SECRET>` |
| 아침 알림 | 매일 08:30 | `https://<앱>/api/cron/notify-morning` | `Authorization: Bearer <CRON_SECRET>` |
| 마감 임박 | 매일 15:00 | `https://<앱>/api/cron/notify-deadline` | `Authorization: Bearer <CRON_SECRET>` |

> cron-job.org 는 잡 설정의 **Advanced → Headers** 에서 `Authorization` 헤더를 추가할 수 있습니다. 타임존은 잡별로 `Asia/Seoul` 로 지정하세요.

`vercel.json` 에는 **백업용** Vercel Cron(`0 22 * * *` UTC = 07:00 KST, 수집만)이 함께 등록되어 있습니다. 시각이 부정확해도 수집 자체에는 무방하며, `CRON_SECRET` 설정 시 Vercel 이 Authorization Bearer 를 자동 부착해 인증됩니다. 정확한 알림 3종은 위 외부 스케줄러가 담당합니다.

### 최초 데이터 적재

배포 직후 DB 는 비어 있습니다. 다음 중 하나로 최초 수집을 트리거하세요.

```bash
# CRON_SECRET 으로 수집 엔드포인트 직접 호출
curl -H "Authorization: Bearer <CRON_SECRET>" https://<앱>/api/cron/scrape
```

또는 앱 화면의 **↻ 새로고침** 버튼(`ADMIN_TOKEN` 입력)으로도 가능합니다.

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
