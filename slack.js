import { setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { action, channel, message, limit } = req.body;

  if (!process.env.SLACK_TOKEN) {
    return res.status(500).json({ error: "SLACK_TOKEN no configurado en variables de entorno." });
  }

  const SLACK_API = "https://slack.com/api";
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.SLACK_TOKEN}`
  };

  try {

    // Listar canales del workspace
    if (action === "listChannels") {
      const r = await fetch(`${SLACK_API}/conversations.list?limit=50&exclude_archived=true`, { headers });
      const data = await r.json();
      if (!data.ok) return res.status(400).json({ error: data.error });
      const channels = data.channels.map(c => ({
        id: c.id,
        name: c.name,
        members: c.num_members,
        topic: c.topic?.value || ""
      }));
      return res.json({ channels });
    }

    // Leer mensajes de un canal
    if (action === "getMessages") {
      if (!channel) return res.status(400).json({ error: "channel requerido" });
      const r = await fetch(`${SLACK_API}/conversations.history?channel=${channel}&limit=${limit || 20}`, { headers });
      const data = await r.json();
      if (!data.ok) return res.status(400).json({ error: data.error });
      const messages = data.messages.map(m => ({
        text: m.text,
        user: m.user,
        ts: new Date(parseFloat(m.ts) * 1000).toLocaleString("es-MX")
      }));
      return res.json({ messages });
    }

    // Enviar mensaje a un canal
    if (action === "sendMessage") {
      if (!channel || !message) return res.status(400).json({ error: "channel y message requeridos" });
      const r = await fetch(`${SLACK_API}/chat.postMessage`, {
        method: "POST",
        headers,
        body: JSON.stringify({ channel, text: message })
      });
      const data = await r.json();
      if (!data.ok) return res.status(400).json({ error: data.error });
      return res.json({ ok: true, ts: data.ts });
    }

    // Listar miembros del workspace
    if (action === "listUsers") {
      const r = await fetch(`${SLACK_API}/users.list`, { headers });
      const data = await r.json();
      if (!data.ok) return res.status(400).json({ error: data.error });
      const users = data.members
        .filter(u => !u.is_bot && !u.deleted)
        .map(u => ({
          id: u.id,
          name: u.real_name || u.name,
          email: u.profile?.email || ""
        }));
      return res.json({ users });
    }

    return res.status(400).json({ error: "Acción no válida. Usa: listChannels, getMessages, sendMessage, listUsers" });

  } catch (e) {
    console.error("Slack error:", e);
    res.status(500).json({ error: e.message });
  }
}
