import { setCors, verifyApiKey, verifyOrigin } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();
  if (!verifyApiKey(req) || !verifyOrigin(req)) return res.status(401).json({ error: "No autorizado." });

  const { token } = req.body;
  if (!token) return res.status(400).json({ ok: false, error: "Token requerido." });

  try {
    const r = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`,
      { method: "POST" }
    );
    const data = await r.json();
    return res.status(200).json({ ok: data.success === true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
