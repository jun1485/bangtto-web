// 웹 푸시 수신과 알림 화면 연결

// 새 알림 처리기로 즉시 교체
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

// 열린 앱 창에 최신 알림 처리기 연결
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 서버가 보낸 예약·빈자리·기록·답변 알림 표시
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || '예약 오픈 알림', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      image: data.image || undefined,
      // 초대 알림도 themeId 를 실어 오므로 예약 오픈 태그보다 먼저 구분
      tag: data.type === 'record' ? `record-${data.reservationId}` : data.type === 'vacancy' ? `vacancy-${data.pushId}` : (data.type === 'invite' || data.type === 'invite_accepted') && data.notificationId ? `invite-${data.notificationId}` : data.type === 'poll' ? `poll-${data.path}` : data.themeId ? `open-${data.themeId}` : data.type === 'reply' ? `reply-${data.path}` : undefined,
      data: {
        type: data.type, themeId: data.themeId, reservationUrl: data.reservationUrl, reservationId: data.reservationId, playedOn: data.playedOn, partySize: data.partySize, path: data.path,
        pushId: data.pushId, track: data.track, notificationId: data.notificationId,
      },
    }),
  );
});

// 알림 종류별 화면 연결
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { type, themeId, reservationUrl, playedOn, partySize, path, pushId, track, notificationId } = event.notification.data || {};
  // 빈자리 알림은 누른 시각 기록 (그때 자리가 남아 있었는지 측정), 실패해도 예약 화면은 열기
  const tracked =
    type === 'vacancy' && typeof pushId === 'string' && track && typeof track.url === 'string' && typeof track.key === 'string'
      && /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/rpc\/open_vacancy_push$/.test(track.url)
      ? fetch(track.url, {
          method: 'POST',
          headers: { apikey: track.key, Authorization: `Bearer ${track.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_id: pushId }),
        }).catch(() => undefined)
      : Promise.resolve();
  event.waitUntil(tracked);
  // 외부 예약 페이지는 앱 창과 별도로 바로 열기
  if (typeof reservationUrl === 'string' && /^https?:\/\//i.test(reservationUrl)) {
    // 앱이 닫혀 있어도 예약 홈페이지 방문 대상 보존
    const remember = themeId
      ? caches.open('reservation-visit-v1').then((cache) => cache.put('/reservation-visit', new Response(JSON.stringify({ themeId, openedAt: Date.now() }))))
      : Promise.resolve();
    event.waitUntil(remember.catch(() => console.warn('예약 홈페이지 방문 저장 실패')).then(() => self.clients.openWindow(reservationUrl)));
    return;
  }
  // 종료 알림은 예약 날짜와 인원을 채운 기록 화면으로 연결
  const params = new URLSearchParams({ themeId: themeId || '', playedOn: playedOn || '', partySize: partySize == null ? '' : String(partySize) });
  // 답변 알림은 내 문의·내 요청 화면으로 (앱 안 경로만)
  const reply = type === 'reply' && typeof path === 'string' && /^\/[a-z-]+$/.test(path) ? path : null;
  // 방또 친구 예약 초대는 초대 화면, 수락은 내 예약 (앱 안 경로만)
  const invitePath = (type === 'invite' || type === 'invite_accepted') && typeof path === 'string' && /^\/(invite\?[\w=&%:.-]*|reservations)$/.test(path) ? path : null;
  // 같이 갈 테마 투표 결과·초대는 투표 화면, 단체톡은 대화 창
  const pollPath = type === 'poll' && typeof path === 'string' && /^\/vote\/[0-9a-f]{12}(\?chat=1)?$/.test(path) ? path : null;
  const noticePath = invitePath ?? pollPath;
  // 서비스 워커에는 로그인 정보가 없어 알림 id 를 넘겨 앱이 알림함 읽음 처리
  const readable = typeof notificationId === 'string' && /^[0-9a-f-]{36}$/i.test(notificationId);
  const invite = noticePath && readable ? `${noticePath}${noticePath.includes('?') ? '&' : '?'}readNotice=${notificationId}` : noticePath;
  const url = reply ?? invite ?? (type === 'record' && themeId && /^\d{4}-\d{2}-\d{2}$/.test(playedOn) ? `/record/new?${params}` : themeId ? `/theme/${encodeURIComponent(themeId)}` : '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // 이 서비스 워커가 맡은 창만 옮길 수 있음, 아니거나 옮기기에 실패하면 새 창으로
      const open = windows.find((client) => client.url.startsWith(self.location.origin) && 'navigate' in client);
      if (!open) return self.clients.openWindow(url);
      return open
        .focus()
        .then((client) => (client || open).navigate(url))
        .then((client) => client || self.clients.openWindow(url))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
