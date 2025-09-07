// api/login.js
import bcrypt from "bcryptjs";
import redis from "./_lib/redis.js";
import { createSession, setSessionCookie } from "./_lib/session.js";
import { rateLimit } from "./_lib/ratelimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const { allowed } = await rateLimit(ip, "login", 20, 60);
  if (!allowed) return res.status(429).json({ error: "Too many attempts, try later." });

  let body = {};
  try { body = JSON.parse(req.body || "{}"); } catch {}
  const { username, password } = body;
  if (!username || !password) return res.status(400).json({ error: "Missing username or password" });

  const uname = String(username).trim().toLowerCase();
  const userId = await redis.get(`user:username:${uname}`);
  if (!userId) return res.status(401).json({ error: "Invalid credentials" });

  const user = await redis.hgetall(`user:id:${userId}`);
  if (!user?.password_hash) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const sid = await createSession(userId, { ua: req.headers["user-agent"] || "", ip });
  setSessionCookie(res, sid);
  res.status(200).json({ userId, username: user.username });
}
