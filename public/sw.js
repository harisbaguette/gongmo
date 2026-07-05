// 서비스 워커: 오프라인 캐시(app shell) + 푸시 이벤트 처리
//
// 캐시 전략(재배포 시 구버전 자산 고착 방지가 핵심):
//  - 정적 자산(JS/CSS/이미지): stale-while-revalidate — 캐시로 즉시 응답하되
//    백그라운드에서 항상 네트워크 재검증→캐시 갱신. 다음 로드에 새 버전 자동 반영.
//    (수동 버전 범프 없이 "코드만 바꾸면 다음 방문에 새 버전"이 성립)
//  - 내비게이션(HTML): network-first — 진입점 문서는 항상 최신을 시도, 오프라인만 캐시 폴백.
//  - API(/api/): network-first — 신선도 우선, 오프라인 시에만 캐시 폴백.
//
// CACHE_VERSION 은 SWR 덕분에 배포마다 손대지 않아도 자산이 갱신되지만,
// 구조가 크게 바뀌어 즉시 전체 무효화가 필요할 때 이 숫자만 올리면 activate 가 구캐시를 모두 지운다.
const CACHE_VERSION = 'v3';
const CACHE = `ipo-calc-${CACHE_VERSION}`;
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  // 셸 프리캐시 실패가 설치 전체를 막지 않도록 개별 요청은 무시(오프라인 최초 설치 대비)
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 현재 버전(CACHE)과 다른 이전 캐시는 모두 삭제 → 재배포 시 구버전 고착 제거
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 캐시 우선 + 백그라운드 재검증(stale-while-revalidate)
function staleWhileRevalidate(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          // 정상 동일 출처 응답만 캐시에 갱신(오류 응답으로 좋은 캐시를 덮지 않음)
          if (res && res.ok && new URL(request.url).origin === self.location.origin) {
            cache.put(request, res.clone());
          }
          return res;
        })
        .catch(() => null);
      // 캐시가 있으면 즉시 반환하고 네트워크 갱신은 백그라운드로, 없으면 네트워크 대기
      return cached || network.then((res) => res || cache.match('/index.html'));
    }),
  );
}

// 네트워크 우선 + 오프라인 캐시 폴백
function networkFirst(request, offlineFallback) {
  return caches.open(CACHE).then((cache) =>
    fetch(request)
      .then((res) => {
        if (res && res.ok && new URL(request.url).origin === self.location.origin) {
          cache.put(request, res.clone());
        }
        return res;
      })
      .catch(() =>
        cache
          .match(request)
          .then((cached) => cached || (offlineFallback ? cache.match(offlineFallback) : undefined)),
      ),
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API: 신선도 우선
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 문서 내비게이션(주소창 진입·새로고침): 항상 최신 index 시도, 오프라인만 캐시
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  // 그 외 정적 자산: stale-while-revalidate 로 자동 갱신
  event.respondWith(staleWhileRevalidate(request));
});

// 푸시 수신 → 알림 표시
self.addEventListener('push', (event) => {
  let data = { title: '공모주 계산기', body: '새로운 공모주 소식이 있습니다.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

// 알림 클릭 → 해당 URL 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
