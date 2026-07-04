// 공모주 계산기 프론트엔드 (바닐라 JS, 빌드 불필요)

const state = {
  ipos: [],
  verdict: 'all',
  hideSpac: false,
  onlyUpcoming: false,
  recommendOnly: false, // 앱 바로가기 '추천 종목'(퍼펙트·청약 고려)용
  vapidPublicKey: null,
};

const NEW_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // 최근 2일 내 등재 = '신규'

// SQLite datetime('now')(UTC, 'YYYY-MM-DD HH:MM:SS') → 최근 등재 여부
function isNew(ipo) {
  if (!ipo.createdAt) return false;
  const t = Date.parse(ipo.createdAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= NEW_WINDOW_MS;
}

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

function badge(tier) {
  const t = tier ?? '미확인';
  return `<span class="badge ${t}">${t}</span>`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 렌더 ──────────────────────────────────────────────
function metric(label, valueHtml, tier) {
  return `<div class="metric"><span class="k">${label}</span><span class="v">${valueHtml}${tier !== undefined ? badge(tier) : ''}</span></div>`;
}

function priceValue(ipo) {
  if (ipo.confirmedPrice == null) return `${fmtNum(ipo.bandLow)}~${fmtNum(ipo.bandHigh)}`;
  return `${fmtNum(ipo.confirmedPrice)}원`;
}

function cardHtml(ipo) {
  const g = ipo.grade;
  const spac = ipo.isSpac ? '<span class="spac-tag">스팩</span>' : '';
  const fresh = isNew(ipo) ? '<span class="new-tag">신규</span>' : '';
  const sched =
    ipo.subscribeStart && ipo.subscribeEnd
      ? `청약 ${ipo.subscribeStart} ~ ${ipo.subscribeEnd}`
      : '청약일 미정';
  const listing = ipo.listingDate ? ` · 상장 ${ipo.listingDate}` : '';
  return `
  <a class="card" href="${ipo.detailUrl}" target="_blank" rel="noopener">
    <div class="card-top">
      <div>
        <div class="card-name">${escapeHtml(ipo.name)}${spac}${fresh}</div>
        <div class="card-sched">${sched}${listing}</div>
      </div>
      <span class="verdict" data-v="${g.verdict}">${g.verdict}</span>
    </div>
    <div class="metrics">
      ${metric('희망/확정가', priceValue(ipo), g.price)}
      ${metric('기관경쟁률', fmtRate(ipo.institutionalRate), g.institutional)}
      ${metric('청약경쟁률', fmtRate(ipo.subscriptionRate), g.subscription)}
      ${metric('의무보유확약', fmtPct(ipo.lockupRatio), g.lockup)}
      ${metric('유통가능물량', fmtPct(ipo.floatRatio), g.float)}
      ${metric('주간사', escapeHtml(ipo.underwriter ?? '-'))}
    </div>
  </a>`;
}

function applyFilters(list) {
  const today = todayStr();
  return list.filter((ipo) => {
    if (state.recommendOnly && ipo.grade.verdict !== '퍼펙트' && ipo.grade.verdict !== '청약 고려')
      return false;
    if (state.verdict !== 'all' && ipo.grade.verdict !== state.verdict) return false;
    if (state.hideSpac && ipo.isSpac) return false;
    if (state.onlyUpcoming) {
      if (!ipo.subscribeEnd || ipo.subscribeEnd < today) return false;
    }
    return true;
  });
}

function render() {
  const filtered = applyFilters(state.ipos);
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty">조건에 맞는 공모주가 없습니다.</div>';
    return;
  }
  listEl.innerHTML = filtered.map(cardHtml).join('');
}

// ── 데이터 로드 ───────────────────────────────────────
async function load() {
  try {
    const res = await fetch('/api/ipos');
    const json = await res.json();
    state.ipos = json.data ?? [];
    const meta = json.meta ?? {};
    const last = meta.lastScrapeAt ? new Date(meta.lastScrapeAt).toLocaleString('ko-KR') : '없음';
    $('#last-updated').textContent = `마지막 수집: ${last} · ${state.ipos.length}건`;
    render();
    updateBadge();
  } catch (err) {
    listEl.innerHTML = '<div class="empty">데이터를 불러오지 못했습니다.</div>';
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

// ── 필터 이벤트 ───────────────────────────────────────
$('#verdict-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('#verdict-filters .chip').forEach((c) => c.classList.remove('active'));
  btn.classList.add('active');
  state.verdict = btn.dataset.verdict;
  state.recommendOnly = false; // 수동 판정 필터는 바로가기 '추천' 필터를 해제
  render();
});
$('#hide-spac').addEventListener('change', (e) => {
  state.hideSpac = e.target.checked;
  render();
});
$('#only-upcoming').addEventListener('change', (e) => {
  state.onlyUpcoming = e.target.checked;
  render();
});

// ── 새로고침 (관리 토큰 필요) ─────────────────────────
$('#btn-refresh').addEventListener('click', async () => {
  let token = localStorage.getItem('adminToken');
  if (!token) {
    token = prompt('관리 토큰을 입력하세요 (.env 의 ADMIN_TOKEN)');
    if (!token) return;
    localStorage.setItem('adminToken', token);
  }
  toast('수집을 시작합니다… 잠시 후 갱신됩니다.');
  try {
    const res = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'x-admin-token': token },
    });
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
});

// ── 다크모드 ──────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('#btn-theme').textContent = theme === 'dark' ? '☀️' : '🌙';
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
$('#btn-push').addEventListener('click', () => togglePush().catch((e) => {
  console.error(e);
  toast('알림 설정 중 오류가 발생했습니다.');
}));

// ── 초기화 ────────────────────────────────────────────
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
// manifest.json 의 shortcuts(/?filter=upcoming|recommend)를 실제 필터로 반영
function applyShortcutFilter() {
  const filter = new URLSearchParams(location.search).get('filter');
  if (filter === 'upcoming') {
    state.onlyUpcoming = true;
    const cb = $('#only-upcoming');
    if (cb) cb.checked = true;
  } else if (filter === 'recommend') {
    state.recommendOnly = true;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => initPushState())
    .catch((err) => console.error('SW 등록 실패', err));
} else {
  $('#btn-push').style.display = 'none';
}

applyShortcutFilter();
load();
