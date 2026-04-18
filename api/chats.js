import { setCors, db } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  // GET — cargar historial
  if (req.method === "GET") {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Se requiere userId." });
    try {
      const data = await db.get(`chats/${userId}`);
      if (!data) return res.status(200).json({ chats: [] });
      const chats = Object.entries(data)
        .map(([id, chat]) => ({ id, ...chat }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 20);
      return res.status(200).json({ chats });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — guardar chat
  if (req.method === "POST") {
    const { userId, chatId, title, messages } = req.body;
    if (!userId || !chatId) return res.status(400).json({ error: "Se requiere userId y chatId." });
    try {
      await db.update(`chats/${userId}/${chatId}`, {
        title:     (title || "Chat nuevo").substring(0, 50),
        messages:  messages || [],
        timestamp: Date.now()
      });
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — borrar chat o todos
  if (req.method === "DELETE") {
    const { userId, chatId } = req.query;
    if (!userId) return res.status(400).json({ error: "Se requiere userId." });
    try {
      const path = chatId ? `chats/${userId}/${chatId}` : `chats/${userId}`;
      await db.set(path, null);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
}