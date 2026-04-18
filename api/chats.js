import { setCors, db } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "Se requiere userId." });
    try {
      const chats = await db.getChats(userId);
      return res.status(200).json({ chats });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {
    const { userId, chatId, title, messages } = req.body;
    if (!userId || !chatId) return res.status(400).json({ error: "Se requiere userId y chatId." });
    try {
      await db.upsertChat(chatId, userId, title || "Chat nuevo", messages || []);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    const { userId, chatId } = req.query;
    if (!userId) return res.status(400).json({ error: "Se requiere userId." });
    try {
      if (chatId) await db.deleteChat(chatId);
      else await db.deleteAllChats(userId);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Método no permitido." });
}
