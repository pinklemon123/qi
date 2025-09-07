// api/logout.js
import { destroySession, clearSessionCookie } from "./lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  await destroySession(req);
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
}
