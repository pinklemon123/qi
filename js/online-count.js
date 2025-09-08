// /js/online-count.js
const EL = document.getElementById('onlineCount');
const WINDOW_SEC = 60;

async function refresh() {
  if (!EL) return;
  const since = new Date(Date.now() - WINDOW_SEC * 1000).toISOString();

  // 只统计数量，limit(0) 避免拉取数据
  const { count, error, status } = await window.supabase
    .from('presence')
    .select('user_id', { count: 'exact' })
    .gt('last_seen', since)
    .limit(0);

  if (error) {
    console.error('[online-count] error', { status, error });
    EL.textContent = '0';
    return;
  }
  EL.textContent = String(count ?? 0);
}

setInterval(refresh, 10_000);
refresh();
