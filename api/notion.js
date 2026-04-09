import { setCors } from "./_lib.js";
import { Client } from "@notionhq/client";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { action, query, pageId } = req.body;

  if (!process.env.NOTION_TOKEN) {
    return res.status(500).json({ error: "NOTION_TOKEN no configurado en variables de entorno." });
  }

  const notion = new Client({ auth: process.env.NOTION_TOKEN });

  try {

    // Buscar páginas o bases de datos
    if (action === "search") {
      const results = await notion.search({
        query: query || "",
        page_size: 10,
        filter: { value: "page", property: "object" }
      });
      const pages = results.results.map(p => ({
        id: p.id,
        title: p.properties?.title?.title?.[0]?.plain_text
               || p.properties?.Name?.title?.[0]?.plain_text
               || "Sin título",
        url: p.url,
        lastEdited: p.last_edited_time
      }));
      return res.json({ pages });
    }

    // Leer contenido de una página
    if (action === "getPage") {
      if (!pageId) return res.status(400).json({ error: "pageId requerido" });
      const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
      const text = blocks.results
        .map(b => {
          const type = b.type;
          const content = b[type]?.rich_text?.map(t => t.plain_text).join("") || "";
          return content;
        })
        .filter(Boolean)
        .join("\n");
      return res.json({ content: text });
    }

    // Listar bases de datos
    if (action === "listDatabases") {
      const results = await notion.search({
        filter: { value: "database", property: "object" },
        page_size: 10
      });
      const dbs = results.results.map(d => ({
        id: d.id,
        title: d.title?.[0]?.plain_text || "Sin título",
        url: d.url
      }));
      return res.json({ databases: dbs });
    }

    // Consultar base de datos
    if (action === "queryDatabase") {
      if (!pageId) return res.status(400).json({ error: "pageId (databaseId) requerido" });
      const rows = await notion.databases.query({ database_id: pageId, page_size: 20 });
      const items = rows.results.map(r => {
        const props = {};
        for (const [key, val] of Object.entries(r.properties)) {
          if (val.type === "title") props[key] = val.title?.[0]?.plain_text || "";
          else if (val.type === "rich_text") props[key] = val.rich_text?.[0]?.plain_text || "";
          else if (val.type === "number") props[key] = val.number;
          else if (val.type === "select") props[key] = val.select?.name || "";
          else if (val.type === "date") props[key] = val.date?.start || "";
          else if (val.type === "checkbox") props[key] = val.checkbox;
        }
        return { id: r.id, url: r.url, properties: props };
      });
      return res.json({ items });
    }

    return res.status(400).json({ error: "Acción no válida. Usa: search, getPage, listDatabases, queryDatabase" });

  } catch (e) {
    console.error("Notion error:", e);
    res.status(500).json({ error: e.message });
  }
}
