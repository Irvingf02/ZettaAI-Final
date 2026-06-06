import { setCors, db } from "./_lib.js";
import crypto from "crypto";

function hashPin(pin) {
  return crypto.createHash("sha256").update(pin + "zettax_salt").digest("hex");
}

export default async function handler(req, res) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Guardar PIN
  if (req.method === "POST") {
    const { uid, pin } = req.body;
    if (!uid || !pin) return res.status(400).json({ error: "Se requiere uid y pin." });
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: "El PIN debe ser de 6 dígitos." });
    try {
      await db.savePin(uid, hashPin(pin));
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Verificar PIN
  if (req.method === "GET") {
    const { uid, pin } = req.query;
    if (!uid || !pin) return res.status(400).json({ error: "Se requiere uid y pin." });
    try {
      const stored = await db.getPin(uid);
      if (!stored) return res.status(404).json({ error: "PIN no configurado." });
      const match = stored === hashPin(pin);
      return res.status(200).json({ ok: match });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
}
