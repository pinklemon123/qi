// 进入队列 -> 轮询 RPC -> 成功返回 matchId
import { startHeartbeat } from '/js/heartbeat.js';
let __mm = null;

export async function startMatchmaking(onMatched) {
  await window.supabase.rpc('enter_queue');           // 入队
  startHeartbeat('matchmaking', true);                // 心跳标注在匹配页

  __mm = 0; // 标记轮询尚未停止
  const poll = async () => {
    try {
      const { data, error } = await window.supabase.rpc('try_match_pair');
      if (!error && data?.matched) {
        const id = data.match_id;
        startHeartbeat('room:' + id, false);          // 进入房间
        if (typeof onMatched === 'function') onMatched(id);
      } else if (__mm !== null) {
        __mm = setTimeout(poll, 1500);
      }
    } catch {
      if (__mm !== null) {
        __mm = setTimeout(poll, 2000);
      }
    }
  };
  poll();
}
export async function stopMatchmaking() {
  if (__mm !== null) { clearTimeout(__mm); __mm = null; }
  await window.supabase.rpc('leave_queue');
  startHeartbeat('lobby', false);
}
