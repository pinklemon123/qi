// 定时把“我在线 & 所在页面/是否排队”写入 presence
let __hb = null;
export function startHeartbeat(page = 'lobby', inQueue = false) {
  stopHeartbeat();
  const tick = async () => {
    try { await window.supabase.rpc('heartbeat', { p_page: page, p_in_queue: inQueue }); } catch {}
  };
  tick();
  __hb = setInterval(tick, 20_000); // 每 20s 一次
}
export function stopHeartbeat() {
  if (__hb) { clearInterval(__hb); __hb = null; }
  window.supabase.rpc('heartbeat', { p_page: 'lobby', p_in_queue: false }).catch(()=>{});
}
window.addEventListener('beforeunload', stopHeartbeat);
