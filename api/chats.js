import { setCors, db, verifyApiKey, verifyOrigin, getVerifiedUid } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!verifyApiKey(req) || !verifyOrigin(req)) return res.status(401).json({ error: "No autorizado." });

  if (req.method === "GET") {

    const { userId: legacyUserId } = req.query;
    if (!legacyUserId) return res.status(400).json({ error: "Se requiere userId." });
    const userId = await getVerifiedUid(req, legacyUserId);
    try {
      const chats = await db.getChats(userId);
      return res.status(200).json({ chats });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "POST") {

    const { userId: legacyUserId, chatId, title, messages, mode } = req.body;
    if (!legacyUserId || !chatId) return res.status(400).json({ error: "Se requiere userId y chatId." });
    if (typeof legacyUserId !== "string" || legacyUserId.length > 128) return res.status(400).json({ error: "userId inválido." });
    if (typeof chatId !== "string" || chatId.length > 128) return res.status(400).json({ error: "chatId inválido." });
    if (title && typeof title !== "string") return res.status(400).json({ error: "title inválido." });
    if (messages && !Array.isArray(messages)) return res.status(400).json({ error: "messages inválido." });
    const userId = await getVerifiedUid(req, legacyUserId);
    try {
      await db.upsertChat(chatId, userId, title || "Chat nuevo", messages || [], mode);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "DELETE") {
    
    const { userId: legacyUserId, chatId } = req.query;
    if (!legacyUserId) return res.status(400).json({ error: "Se requiere userId." });
    if (typeof legacyUserId !== "string" || legacyUserId.length > 128) return res.status(400).json({ error: "userId inválido." });
    const userId = await getVerifiedUid(req, legacyUserId);
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
