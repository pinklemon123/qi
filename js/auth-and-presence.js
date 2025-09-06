// /js/auth-and-presence.js
const emailInput    = document.getElementById('emailInput');
const emailBtn      = document.getElementById('emailLoginBtn');
const logoutBtn     = document.getElementById('logoutBtn');
const whoami        = document.getElementById('whoami');
const onlineCountEl = document.getElementById('onlineCount');

let lobbyChannel = null;

async function refreshAuthUI() {
  const { data: { user } } = await window.supabase.auth.getUser();
  if (user) {
    if (emailInput) emailInput.style.display = 'none';
    if (emailBtn)   emailBtn.style.display   = 'none';
    if (logoutBtn)  logoutBtn.style.display  = 'inline-block';
    if (whoami)     whoami.textContent = `已登录：${user.email || user.id.slice(0,8)}`;
    ensurePresence(user);
  } else {
    if (whoami)     whoami.textContent = '';
    if (emailInput) emailInput.style.display = 'inline-block';
    if (emailBtn)   emailBtn.style.display   = 'inline-block';
    if (logoutBtn)  logoutBtn.style.display  = 'none';
    teardownPresence();
  }
}

// 发送魔法链接（带回跳）
emailBtn?.addEventListener('click', async () => {
  const email = (emailInput?.value || '').trim();
  if (!email) return alert('请输入邮箱');
  const { error } = await window.supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + '/auth/callback' }
  });
  if (error) return alert('发送失败：' + error.message);
  alert('已发送登录链接，请去邮箱点击完成登录');
});

// 退出
logoutBtn?.addEventListener('click', async () => {
  await window.supabase.auth.signOut();
  await refreshAuthUI();
});

// 登录状态变化（从邮箱回跳后会触发）
window.supabase.auth.onAuthStateChange(async () => {
  await refreshAuthUI();
});

// --- 替换 ensurePresence ---
async function ensurePresence(user) {
  if (lobbyChannel) return;

  // 再保险：把 access_token 交给 Realtime
  const { data: { session } } = await window.supabase.auth.getSession();
  if (session?.access_token) window.supabase.realtime.setAuth(session.access_token);

  // 改成 'lobby'，并打开 broadcast（self:true 方便本页自收自发做回环测试）
  lobbyChannel = window.supabase.channel('lobby', {
    config: {
      presence:  { key: user.id },
      broadcast: { self: true }
    }
  });

  // 收到 ping 就在控制台打印，便于你确认连通性
  lobbyChannel.on('broadcast', { event: 'ping' }, (p) => {
    console.log('[broadcast/ping] recv', p);
  });

  // 每次同步统计唯一在线用户
  lobbyChannel.on('presence', { event: 'sync' }, () => {
    const state = lobbyChannel.presenceState();
    const uniqueUsers = Object.keys(state).length;
    if (onlineCountEl) onlineCountEl.textContent = String(uniqueUsers);
    // console.log('[presence sync]', state);
  });

  // 等 SUBSCRIBED 再上报 presence（关键）
  await new Promise((resolve) => {
    lobbyChannel.subscribe((status) => status === 'SUBSCRIBED' && resolve());
  });

  // 上报“我在”
  await lobbyChannel.track({ at: Date.now() });

  // 发一个可见的广播，Inspector 能看到
  await lobbyChannel.send({
    type: 'broadcast',
    event: 'ping',
    payload: { from: 'web', t: Date.now() }
  });
}


// --- 替换 teardownPresence ---
async function teardownPresence() {
  if (lobbyChannel) {
    await lobbyChannel.unsubscribe();
    lobbyChannel = null;
  }
  if (onlineCountEl) onlineCountEl.textContent = '0';
}


// 启动
refreshAuthUI();
