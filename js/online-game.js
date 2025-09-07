// 把匹配得到的 matchId 接到你的棋盘：
// 1) 监听“本地落子”事件 -> 写入 moves
// 2) 轮询 moves -> 把对方落子应用到本地棋盘
import { startMovePolling, pushMove, stopMovePolling } from '/js/room-sync.js';

// 在 ui-view.js 里，会 dispatch 一个 'local-move' 事件（见下面补丁）
// 这里接住并推进 DB；同时轮询 DB 应用对方走子。
export async function startOnlineGame(matchId) {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (!user) { alert('请先登录'); return; }

  // 读当前最大 ply，作为下一步的编号
  let nextPly = 1;
  try {
    const { data } = await window.supabase
      .from('moves').select('ply').eq('match_id', matchId)
      .order('ply', { ascending: false }).limit(1);
    nextPly = (data?.[0]?.ply || 0) + 1;
  } catch {}

  // 监听本地落子（由 ui-view.js 触发）
  const onLocal = async (ev) => {
    const { from, to } = ev.detail || {};
    const ply = nextPly++;
    try {
      // 将这一步写入数据库
      await pushMove({
        matchId,
        ply,
        from: `${from.row},${from.col}`,
        to:   `${to.row},${to.col}`,
        userId: user.id
      });
    } catch (e) {
      nextPly--; // 失败时回退编号
      alert('落子保存失败，请重试');
      // 撤销乐观更新并停止轮询
      document.getElementById('undoBtn')?.click();
      window.removeEventListener('local-move', onLocal);
      stopMovePolling();
    }
  };
  window.addEventListener('local-move', onLocal);

  // 轮询对方落子：收到新步时，调用 ui-core.commitMove 应用到棋盘
  // 说明：如果是自己写入的步，这里也会拿到；我们用 mover 区分并跳过重复应用。
  startMovePolling(matchId, (m) => {
    if (m.mover === user.id) return;     // 自己的步本地已应用
    try {
      const [fr, fc] = m.from.split(',').map(Number);
      const [tr, tc] = m.to.split(',').map(Number);
      // 动态导入以避免循环引用
      import('/js/ui-core.js').then(core => {
        core.commitMove({ row: fr, col: fc }, { row: tr, col: tc });
      });
    } catch (e) { /* ignore */ }
  });

  // 暴露个停止方法（可选）
  window.__stopOnlineGame = () => {
    window.removeEventListener('local-move', onLocal);
    import('/js/room-sync.js').then(m => m.stopMovePolling());
  };
}

// 允许通过 URL 直接进入对局：/?matchId=123
export async function bootFromURL() {
  const m = new URL(location.href).searchParams.get('matchId');
  if (m) await startOnlineGame(Number(m));
}
