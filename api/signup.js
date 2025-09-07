// api/signup.js
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import redis from "./_lib/redis.js";
import { createSession, setSessionCookie } from "./_lib/session.js";
import { rateLimit } from "./_lib/ratelimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const { allowed } = await rateLimit(ip, "signup", 5, 300);
  if (!allowed) return res.status(429).json({ error: "Too many attempts, try later." });

  let body = {};
  try { body = JSON.parse(req.body || "{}"); } catch {}
  const { username, password } = body;
  if (!username || !password) return res.status(400).json({ error: "Missing username or password" });

  const uname = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_][a-z0-9_\-\.]{2,31}$/.test(uname)) {
    return res.status(400).json({ error: "Invalid username format" });
  }
  if (password.length < 6) return res.status(400).json({ error: "Password too short (>=6)" });

  const userKeyByName = `user:username:${uname}`;
  const userId = nanoid(16);
  const pwdHash = await bcrypt.hash(password, 10);

  // set NX 保证唯一
  const nx = await redis.set(userKeyByName, userId, { nx: true });
  if (nx !== "OK") {
    return res.status(409).json({ error: "Username already taken" });
  }

  try {
    await redis.hset(`user:id:${userId}`, {
      id: userId,
      username: uname,
      password_hash: pwdHash,
      created_at: Date.now().toString(),
    });
  } catch (e) {
    // 回滚索引
    await redis.del(userKeyByName);
    throw e;
  }

  const sid = await createSession(userId, { ua: req.headers["user-agent"] || "", ip });
  setSessionCookie(res, sid);
  res.status(201).json({ userId, username: uname });
}
