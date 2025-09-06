// /js/online-count.js
const EL = document.getElementById('onlineCount');
const WINDOW_SEC = 60;

async function refresh() {
  if (!EL) return;
  const since = new Date(Date.now() - WINDOW_SEC * 1000).toISOString();

  // 用 GET（不再用 head:true），这样即使出错也能看到 message
  const { data, count, error, status } = await window.supabase
    .from('presence')
    .select('user_id,last_seen', { count: 'exact' })  // 不用 head:true
    .gt('last_seen', since)
    .limit(1);  // 限制返回行数，避免拉全表

  if (error) {
    console.error('[online-count] error', { status, error });
    EL.textContent = '0';
    return;
  }
  EL.textContent = String(count ?? (data?.length || 0));
}

setInterval(refresh, 10_000);
refresh();
