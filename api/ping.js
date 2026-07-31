import { setCors, db, verifyApiKey, verifyOrigin } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!verifyApiKey(req) && !req.headers["x-vercel-cron"]) return res.status(401).json({ error: "No autorizado." });

  try {
    await db.getChats("ping");
    return res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
