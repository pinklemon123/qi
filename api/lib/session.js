// api/_lib/session.js
import { nanoid } from "nanoid";
import cookie from "cookie";
import redis from "./redis.js";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "sid";
// SESSION_TTL_SECONDS<=0 表示永不过期
const SESSION_TTL = parseInt(process.env.SESSION_TTL_SECONDS || "0", 10);
const PERMANENT_MAX_AGE = 60 * 60 * 24 * 365 * 10; // 10年

export function parseCookies(req) {
  return cookie.parse(req.headers.cookie || "");
}

export async function createSession(userId, meta = {}) {
  const sid = nanoid(32);
  const key = `session:${sid}`;
  const payload = {
    userId,
    ua: meta.ua || "",
    ip: meta.ip || "",
    createdAt: Date.now(),
  };
  // Upstash set + EX（>0）或永久保存
  if (SESSION_TTL > 0) {
    await redis.set(key, JSON.stringify(payload), { ex: SESSION_TTL });
  } else {
    await redis.set(key, JSON.stringify(payload));
  }
  return sid;
}

export async function getSession(req) {
  const sid = parseCookies(req)[COOKIE_NAME];
  if (!sid) return null;
  const raw = await redis.get(`session:${sid}`);
  if (!raw) return null;
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { sid, ...data };
  } catch {
    return null;
  }
}

export async function destroySession(req) {
  const sid = parseCookies(req)[COOKIE_NAME];
  if (sid) await redis.del(`session:${sid}`);
}

export function setSessionCookie(res, sid) {
  const isProd = process.env.VERCEL === "1";
  const opts = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: SESSION_TTL > 0 ? SESSION_TTL : PERMANENT_MAX_AGE,
  };
  const header = cookie.serialize(COOKIE_NAME, sid, opts);
  res.setHeader("Set-Cookie", header);
}

export function clearSessionCookie(res) {
  const header = cookie.serialize(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.VERCEL === "1",
    path: "/",
    maxAge: 0,
  });
  res.setHeader("Set-Cookie", header);
}
