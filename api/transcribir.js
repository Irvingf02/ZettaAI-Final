import { setCors } from "./_lib.js";
import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const form = formidable({ keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: "Error al procesar el audio." });

    const audioFile = files.file?.[0] || files.file;
    if (!audioFile) return res.status(400).json({ error: "No se recibió audio." });

    try {
      const fileStream = fs.createReadStream(audioFile.filepath);
      const FormData = (await import("form-data")).default;
      const fd = new FormData();
      fd.append("file", fileStream, { filename: "audio.webm", contentType: audioFile.mimetype || "audio/webm" });
      fd.append("model", "whisper-large-v3");
      fd.append("language", "es");
      fd.append("response_format", "json");

      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          ...fd.getHeaders()
        },
        body: fd
      });

      if (!response.ok) {
        const err = await response.json();
        return res.status(response.status).json({ error: err.error?.message || "Error de Groq" });
      }

      const data = await response.json();
      res.json({ text: data.text || "" });

    } catch (e) {
      res.status(500).json({ error: "Error interno al transcribir." });
    }
  });
}
