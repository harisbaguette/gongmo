// 공모주 계산기 프론트엔드 (바닐라 JS, 빌드 불필요)

const state = {
  ipos: [],
  tab: 'active', // 'active'(청약: subscribeEnd >= 오늘) | 'past'(지난)
  recommendOnly: false, // 퍼펙트·청약 고려만
  showSpac: false, // 스팩 포함 여부 (기본 제외)
  vapidPublicKey: null,
};

const NEW_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 최근 2일 내 등재 = '신규'
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const $ = (sel) => document.querySelector(sel);
const listEl = $('#list');
const toastEl = $('#toast');

// ── 유틸 ──────────────────────────────────────────────
// innerHTML 삽입 전 HTML 특수문자 이스케이프 (스크래핑 문자열 XSS 방지)
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// href 로 넣기 전 http/https 스킴만 허용 (javascript: 등 차단)
function safeUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u, 'https://www.38.co.kr');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function fmtNum(n, digits = 0) {
  if (n == null) return '미정';
  return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

function fmtPct(n) {
  return n == null ? '미확인' : `${Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
}

function fmtRate(n) {
  return n == null ? '미정' : `${Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}:1`;
}

// 'YYYY-MM-DD' → 로컬 자정 기준 Date
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function todayDate() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function todayStr() {
  const d = todayDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// '7.8(화)' — 올해면 연도 생략
function fmtDay(s) {
  const dt = parseDate(s);
  if (!dt) return '';
  const y = dt.getFullYear() === new Date().getFullYear() ? '' : `${dt.getFullYear()}. `;
  return `${y}${dt.getMonth() + 1}.${dt.getDate()}(${WEEKDAY[dt.getDay()]})`;
}

function fmtRange(a, b) {
  const da = fmtDay(a);
  const db = fmtDay(b);
  if (da && db) return `청약 ${da}~${db}`;
  if (da || db) return `청약 ${da || db}`;
  return '청약일 미정';
}

// SQLite datetime('now')(UTC) → 최근 등재 여부
function isNew(ipo) {
  if (!ipo.createdAt) return false;
  const t = Date.parse(ipo.createdAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= NEW_WINDOW_MS;
}

// start <= 오늘 <= end (청약 진행 중)
function isSubscribing(ipo) {
  const today = todayDate();
  const s = parseDate(ipo.subscribeStart);
  const e = parseDate(ipo.subscribeEnd);
  if (e && today > e) return false;
  if (s) return today >= s; // 시작 지남 = 진행 중 (end 이내)
  return true; // 시작일 미상이나 아직 마감 전 → 진행 중으로 간주
}

// 오늘 < 청약 시작 (예정)
function isUpcoming(ipo) {
  const s = parseDate(ipo.subscribeStart);
  return !!(s && todayDate() < s);
}

// ── 상태 계산 ─────────────────────────────────────────
// D-day 칩: { label, tone } (tone: positive | neutral | muted)
function scheduleChip(ipo, tab) {
  const today = todayDate();
  if (tab === 'active') {
    const start = parseDate(ipo.subscribeStart);
    const end = parseDate(ipo.subscribeEnd);
    if (start && today < start) {
      return { label: `청약 D-${daysBetween(today, start)}`, tone: 'neutral' };
    }
    if (end) {
      const dToEnd = daysBetween(today, end);
      if (start && daysBetween(today, start) === 0) return { label: '오늘 청약', tone: 'positive' };
      if (dToEnd === 0) return { label: '오늘 마감', tone: 'positive' };
      if (dToEnd > 0) return { label: `마감 D-${dToEnd}`, tone: 'positive' };
    }
    return { label: '청약중', tone: 'positive' };
  }
  // past
  const listing = parseDate(ipo.listingDate);
  if (listing) {
    const d = daysBetween(today, listing);
    if (d > 0) return { label: `상장 D-${d}`, tone: 'neutral' };
    if (d === 0) return { label: '오늘 상장', tone: 'positive' };
  }
  return { label: '종료', tone: 'muted' };
}

function verdictTone(v) {
  if (v === '퍼펙트' || v === '청약 고려') return 'positive';
  if (v === '판정 대기') return 'neutral';
  return 'muted'; // 진입 X
}

// ── 렌더: 청약 탭 카드 ───────────────────────────────
function gradeBadge(tier) {
  const t = tier ?? '미확인';
  return `<span class="g-badge g-${escapeHtml(t)}">${escapeHtml(t)}</span>`;
}

function metricRow(label, valueHtml, tier) {
  return `<tr><th scope="row">${label}</th><td>${valueHtml}</td><td>${gradeBadge(tier)}</td></tr>`;
}

function cardHtml(ipo) {
  const g = ipo.grade;
  const chip = scheduleChip(ipo, 'active');
  const tags =
    (isNew(ipo) ? '<span class="tag tag-new">신규</span>' : '') +
    (ipo.isSpac ? '<span class="tag tag-spac">스팩</span>' : '');
  const url = safeUrl(ipo.detailUrl);
  const metaParts = [];
  if (ipo.underwriter) metaParts.push(escapeHtml(ipo.underwriter));
  metaParts.push(`상장 ${fmtDay(ipo.listingDate) || '미정'}`);
  if (url) {
    metaParts.push(
      `<a class="meta-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">38.co.kr</a>`,
    );
  }
  return `
  <article class="card">
    <div class="card-head">
      <div class="card-title">
        <span class="card-name">${escapeHtml(ipo.name)}</span>
        ${tags}
      </div>
      <span class="chip-dday tone-${chip.tone}">${chip.label}</span>
    </div>
    <div class="card-price-row">
      <div class="price">
        <span class="price-val">${fmtNum(ipo.confirmedPrice)}<span class="price-unit">원</span></span>
        <span class="price-sub">${fmtRange(ipo.subscribeStart, ipo.subscribeEnd)}</span>
      </div>
      <span class="verdict tone-${verdictTone(g.verdict)}">${escapeHtml(g.verdict)}</span>
    </div>
    <table class="metrics-table">
      <thead><tr><th scope="col">지표</th><th scope="col">값</th><th scope="col">등급</th></tr></thead>
      <tbody>
        ${metricRow('기관경쟁률', fmtRate(ipo.institutionalRate), g.institutional)}
        ${metricRow('청약경쟁률', fmtRate(ipo.subscriptionRate), g.subscription)}
        ${metricRow('의무보유확약', fmtPct(ipo.lockupRatio), g.lockup)}
        ${metricRow('유통가능물량', fmtPct(ipo.floatRatio), g.float)}
      </tbody>
    </table>
    <p class="card-meta">${metaParts.join(' · ')}</p>
  </article>`;
}

// ── 렌더: 지난 공모 표 ───────────────────────────────
function pastRowHtml(ipo) {
  const g = ipo.grade;
  const url = safeUrl(ipo.detailUrl);
  const spac = ipo.isSpac ? '<span class="past-spac">스팩</span>' : '';
  const attrs = url
    ? ` data-href="${escapeHtml(url)}" tabindex="0" role="link" aria-label="${escapeHtml(ipo.name)} 상세 보기"`
    : '';
  return `<tr class="past-row"${attrs}>
    <td class="past-name">${escapeHtml(ipo.name)}${spac}</td>
    <td class="num">${fmtNum(ipo.confirmedPrice)}</td>
    <td><span class="verdict-mini tone-${verdictTone(g.verdict)}">${escapeHtml(g.verdict)}</span></td>
    <td class="num">${fmtDay(ipo.listingDate) || '미정'}</td>
  </tr>`;
}

function pastTableHtml(list) {
  return `<table class="past-table">
    <caption class="sr-only">지난 공모 목록</caption>
    <thead><tr>
      <th scope="col">종목명</th><th scope="col">확정가</th><th scope="col">판정</th><th scope="col">상장</th>
    </tr></thead>
    <tbody>${list.map(pastRowHtml).join('')}</tbody>
  </table>`;
}

// ── 필터 (탭별 정렬은 render 에서) ────────────────────
function passesFilter(ipo) {
  if (ipo.confirmedPrice == null) return false; // 미확정 공모가 제외
  if (!state.showSpac && ipo.isSpac) return false; // 스팩 기본 제외
  if (
    state.recommendOnly &&
    ipo.grade.verdict !== '퍼펙트' &&
    ipo.grade.verdict !== '청약 고려'
  )
    return false;
  return true;
}

function emptyMsg() {
  if (state.tab === 'active') {
    return state.recommendOnly
      ? '지금 추천할 만한 공모주가 없어요.'
      : '지금 청약할 수 있는 공모주가 없어요.';
  }
  return '지난 공모 내역이 없어요.';
}

function render() {
  listEl.setAttribute('aria-busy', 'false');
  const today = todayStr();
  const pool = state.ipos.filter(passesFilter);

  if (state.tab === 'active') {
    const active = pool.filter((i) => i.subscribeEnd && i.subscribeEnd >= today);
    if (active.length === 0) {
      listEl.innerHTML = `<div class="empty">${emptyMsg()}</div>`;
      return;
    }
    // 그룹: 지금 청약 중(마감 임박순) / 청약 예정(시작일순)
    const now = active
      .filter((i) => !isUpcoming(i))
      .sort((a, b) => (a.subscribeEnd ?? '').localeCompare(b.subscribeEnd ?? ''));
    const soon = active
      .filter(isUpcoming)
      .sort((a, b) => (a.subscribeStart ?? '').localeCompare(b.subscribeStart ?? ''));
    let html = '';
    if (now.length) html += `<h2 class="section-head">지금 청약 중</h2>` + now.map(cardHtml).join('');
    if (soon.length) html += `<h2 class="section-head">청약 예정</h2>` + soon.map(cardHtml).join('');
    listEl.innerHTML = html;
  } else {
    // 지난 공모: subscribeEnd < 오늘, 최신순
    const past = pool
      .filter((i) => !i.subscribeEnd || i.subscribeEnd < today)
      .sort((a, b) => (b.subscribeEnd ?? '').localeCompare(a.subscribeEnd ?? ''));
    if (past.length === 0) {
      listEl.innerHTML = `<div class="empty">${emptyMsg()}</div>`;
      return;
    }
    listEl.innerHTML = pastTableHtml(past);
  }
}

// ── 데이터 로드 ───────────────────────────────────────
async function load() {
  try {
    const res = await fetch('/api/ipos');
    const json = await res.json();
    state.ipos = json.data ?? [];
    const meta = json.meta ?? {};
    const last = meta.lastScrapeAt ? new Date(meta.lastScrapeAt).toLocaleString('ko-KR') : '없음';
    $('#last-updated').textContent = `마지막 수집: ${last}`;
    render();
    updateBadge();
  } catch (err) {
    listEl.setAttribute('aria-busy', 'false');
    listEl.innerHTML = '<div class="empty">데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>';
    console.error(err);
  }
}

// 앱 배지: 오늘 청약/상장 예정인 퍼펙트·청약고려 종목 수 (Badging API)
function updateBadge() {
  const today = todayStr();
  const count = state.ipos.filter(
    (i) =>
      (i.grade.verdict === '퍼펙트' || i.grade.verdict === '청약 고려') &&
      (i.subscribeStart === today || i.subscribeEnd === today || i.listingDate === today),
  ).length;
  if ('setAppBadge' in navigator) {
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge?.().catch(() => {});
  }
}

// ── 지난 공모 표: 행 전체 링크(터치·키보드) ──────────
function openRow(row) {
  const href = row?.dataset?.href;
  if (href) window.open(href, '_blank', 'noopener');
}
listEl.addEventListener('click', (e) => {
  const row = e.target.closest('.past-row');
  if (row) openRow(row);
});
listEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.past-row');
  if (!row) return;
  e.preventDefault();
  openRow(row);
});

// ── 탭 / 필터 이벤트 ──────────────────────────────────
$('#segment').addEventListener('click', (e) => {
  const btn = e.target.closest('.segment-btn');
  if (!btn) return;
  state.tab = btn.dataset.tab;
  document.querySelectorAll('#segment .segment-btn').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  render();
});

$('#verdict-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('#verdict-filters .chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
  state.recommendOnly = btn.dataset.filter === 'recommend';
  render();
});

$('#show-spac').addEventListener('change', (e) => {
  state.showSpac = e.target.checked;
  render();
});

// ── 새로고침 (관리자 전용: ?admin=1) ─────────────────
async function doRefresh() {
  let token = localStorage.getItem('adminToken');
  if (!token) {
    token = prompt('관리 토큰을 입력하세요 (.env 의 ADMIN_TOKEN)');
    if (!token) return;
    localStorage.setItem('adminToken', token);
  }
  toast('수집을 시작합니다… 잠시 후 갱신됩니다.');
  try {
    const res = await fetch('/api/refresh', { method: 'POST', headers: { 'x-admin-token': token } });
    if (res.status === 401) {
      localStorage.removeItem('adminToken');
      toast('토큰이 올바르지 않습니다.');
      return;
    }
    if (res.status === 409) {
      toast('이미 수집이 진행 중입니다.');
      return;
    }
    const json = await res.json();
    if (json.error) {
      toast(`수집 실패: ${json.error.message}`);
      return;
    }
    toast(`수집 완료 (목록 ${json.data.listCount}건)`);
    load();
  } catch (err) {
    toast('수집 요청 실패');
    console.error(err);
  }
}

function initAdmin() {
  if (new URLSearchParams(location.search).get('admin') === '1') {
    const btn = $('#btn-refresh');
    if (btn) {
      btn.hidden = false;
      btn.addEventListener('click', doRefresh);
    }
  }
}

// ── 다크모드 ──────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#btn-theme').setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
  localStorage.setItem('theme', theme);
}
$('#btn-theme').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(cur);
});
(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ?? (prefersDark ? 'dark' : 'light'));
})();

// ── 푸시 구독 ─────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function togglePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('이 브라우저는 푸시를 지원하지 않습니다.');
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();

  if (existing) {
    await fetch('/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: existing.endpoint }),
    });
    await existing.unsubscribe();
    $('#btn-push').classList.remove('active');
    toast('알림을 해제했습니다.');
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('알림 권한이 거부되었습니다.');
    return;
  }
  if (!state.vapidPublicKey) {
    toast('서버에 푸시 키가 설정되지 않았습니다.');
    return;
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey),
  });
  await fetch('/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  });
  $('#btn-push').classList.add('active');
  toast('알림을 구독했습니다.');
}
$('#btn-push').addEventListener('click', () =>
  togglePush().catch((e) => {
    console.error(e);
    toast('알림 설정 중 오류가 발생했습니다.');
  }),
);

async function initPushState() {
  try {
    const res = await fetch('/api/config');
    const json = await res.json();
    state.vapidPublicKey = json.data?.vapidPublicKey ?? null;
    if (!json.data?.pushEnabled) {
      $('#btn-push').style.display = 'none';
      return;
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) $('#btn-push').classList.add('active');
    }
  } catch (err) {
    console.error(err);
  }
}

// ── 앱 바로가기(App Shortcuts) 딥링크 필터 적용 ─────────
// manifest.json 의 shortcuts(/?filter=upcoming|recommend)를 새 구조에 반영
function applyShortcutFilter() {
  const filter = new URLSearchParams(location.search).get('filter');
  state.tab = 'active'; // 두 바로가기 모두 청약 탭
  if (filter === 'recommend') {
    state.recommendOnly = true;
    const chip = document.querySelector('#verdict-filters .chip[data-filter="recommend"]');
    if (chip) {
      document.querySelectorAll('#verdict-filters .chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
    }
  }
}

// ── 초기화 ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => initPushState())
    .catch((err) => console.error('SW 등록 실패', err));
} else {
  $('#btn-push').style.display = 'none';
}

initAdmin();
applyShortcutFilter();
load();
