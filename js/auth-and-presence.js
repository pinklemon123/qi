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

// Presence：大厅在线人数
async function ensurePresence(user) {
  if (lobbyChannel) return;
  lobbyChannel = window.supabase.channel('presence:lobby', {
    config: { presence: { key: user.id } }
  });
  lobbyChannel.on('presence', { event: 'sync' }, () => {
    const state = lobbyChannel.presenceState();
    const count = Object.values(state).reduce((n, arr) => n + arr.length, 0);
    if (onlineCountEl) onlineCountEl.textContent = String(count);
  });
  await lobbyChannel.subscribe();
  lobbyChannel.track({ at: Date.now() });
}

async function teardownPresence() {
  if (lobbyChannel) {
    await lobbyChannel.unsubscribe();
    lobbyChannel = null;
    if (onlineCountEl) onlineCountEl.textContent = '0';
  }
}

// 启动
refreshAuthUI();
