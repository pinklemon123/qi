// 用 moves 表做“短轮询同步”，不依赖 Realtime
let __poll = null;
let __lastPly = 0;

export async function pushMove({ matchId, ply, from, to, piece, fenBefore, fenAfter, userId }) {
  await window.supabase.from('moves').insert({
    match_id: matchId, ply, mover: userId,
    from, to, piece, fen_before: fenBefore, fen_after: fenAfter
  });
}

export function startMovePolling(matchId, applyMove) {
  stopMovePolling();
  __lastPly = 0;

  const poll = async () => {
    try {
      const { data, error } = await window.supabase
        .from('moves')
        .select('ply, mover, from, to, piece, fen_after')
        .eq('match_id', matchId)
        .gt('ply', __lastPly)
        .order('ply', { ascending: true });

      if (!error && data?.length) {
        for (const m of data) {
          __lastPly = Math.max(__lastPly, m.ply);
          if (typeof applyMove === 'function') applyMove(m);
        }
      }
    } finally {
      __poll = setTimeout(poll, 1200); // 1.2s 刷一次
    }
  };
  poll();
}
export function stopMovePolling() {
  if (__poll) { clearTimeout(__poll); __poll = null; }
}
