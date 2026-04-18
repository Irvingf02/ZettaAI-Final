import { setCors, db } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Se requiere userId." });
    try {
      const data = await db.getUser(userId);
      if (!data) return res.status(200).json({ premium: false, plan: "free", fecha: "", cnt_chat: 0, cnt_resumen: 0, cnt_ideas: 0, cnt_tarea: 0, cnt_imagen: 0, cnt_codigo: 0 });
      return res.status(200).json({
        premium:     data.premium     || false,
        plan:        data.plan        || "free",
        fecha:       data.fecha       || "",
        cnt_chat:    data.cnt_chat    || 0,
        cnt_resumen: data.cnt_resumen || 0,
        cnt_ideas:   data.cnt_ideas   || 0,
        cnt_tarea:   data.cnt_tarea   || 0,
        cnt_imagen:  data.cnt_imagen  || 0,
        cnt_codigo:  data.cnt_codigo  || 0,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { userId, email, fecha, cnt_chat, cnt_resumen, cnt_ideas, cnt_tarea, cnt_imagen, cnt_codigo } = req.body;
    if (!userId) return res.status(400).json({ error: "Se requiere userId." });
    try {
      await db.upsertUser(userId, {
        ...(email ? { email } : {}),
        fecha:       fecha       || "",
        cnt_chat:    cnt_chat    || 0,
        cnt_resumen: cnt_resumen || 0,
        cnt_ideas:   cnt_ideas   || 0,
        cnt_tarea:   cnt_tarea   || 0,
        cnt_imagen:  cnt_imagen  || 0,
        cnt_codigo:  cnt_codigo  || 0,
        updated_at:  new Date().toISOString()
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
}
