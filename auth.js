async function postJSON(url, data) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function me() {
  const res = await fetch("/api/me", { credentials: "include" });
  return res.json();
}

function getNextParam() {
  const sp = new URLSearchParams(location.search);
  return sp.get("next");
}

function buildNext(url = location.pathname + location.search) {
  return encodeURIComponent(url);
}

function requireLogin() {
  return me().then(({ user }) => {
    if (!user) {
      const next = buildNext();
      location.href = `/login.html?next=${next}`;
      return new Promise(() => {}); // 阻断后续执行
    }
    return user;
  });
}

function redirectAfterLogin() {
  const next = getNextParam();
  location.href = next || "/";
}

async function signup({ username, password }) {
  return postJSON("/api/signup", { username, password });
}

async function login({ username, password }) {
  return postJSON("/api/login", { username, password });
}

async function logout() {
  await postJSON("/api/logout", {});
  const next = buildNext("/"); // 退出后回首页
  location.href = `/login.html?next=${next}`;
}

function mountUserBar(user, { showLobby = true } = {}) {
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;top:12px;right:12px;background:rgba(0,0,0,.45);padding:8px 12px;border-radius:12px;color:#fff;font:14px/1.2 system-ui;display:flex;gap:8px;align-items:center;z-index:9999;";
  bar.innerHTML = `
    <span>👋 ${user.username}</span>
    ${showLobby ? `<a href="/mode.html" style="color:#c7d2fe;text-decoration:none;">匹配大厅</a>` : `<a href="/" style="color:#c7d2fe;text-decoration:none;">回到首页</a>`}
    <button id="__logout" style="margin-left:4px;border:0;border-radius:8px;padding:4px 8px;cursor:pointer">退出</button>
  `;
  document.body.appendChild(bar);
  document.getElementById("__logout").onclick = logout;
}

window.Auth = { me, requireLogin, redirectAfterLogin, signup, login, logout, mountUserBar };
