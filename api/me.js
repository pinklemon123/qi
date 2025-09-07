// api/me.js
import redis from "./lib/redis.js";
import { getSession } from "./lib/session.js";

export default async function handler(req, res) {
  const sess = await getSession(req);
  if (!sess) return res.status(200).json({ user: null });

  const user = await redis.hgetall(`user:id:${sess.userId}`);
  if (!user?.id) return res.status(200).json({ user: null });

  res.status(200).json({
    user: {
      id: user.id,
      username: user.username,
      created_at: Number(user.created_at) || null,
      last_login_at: Number(user.last_login_at) || null,
    },
  });
}
