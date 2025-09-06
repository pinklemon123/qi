// 统计“最近 N 秒有心跳”的人数，显示到 #onlineCount
const EL = document.getElementById('onlineCount');
const WINDOW_SEC = 60;
async function refresh() {
  if (!EL) return;
  const since = new Date(Date.now() - WINDOW_SEC * 1000).toISOString();
  const { count, error } = await window.supabase
    .from('presence').select('*', { head: true, count: 'exact' })
    .gt('last_seen', since);
  if (!error) EL.textContent = String(count ?? 0);
}
setInterval(refresh, 10_000);
refresh();
