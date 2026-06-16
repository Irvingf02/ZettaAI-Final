import { setCors, verifyApiKey, verifyOrigin, db } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { uid, imageB64 } = req.body;

  if (!verifyApiKey(req) || !verifyOrigin(req)) {
    return res.status(401).json({ ok: false, reply: "No autorizado." });
  }
  if (!uid || typeof uid !== "string") {
    return res.status(400).json({ ok: false, reply: "Usuario inválido." });
  }
  if (!imageB64 || typeof imageB64 !== "string") {
    return res.status(400).json({ ok: false, reply: "Falta la imagen de la credencial." });
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analiza esta imagen. ¿Es una credencial de estudiante vigente de alguna institución educativa (escuela, universidad, instituto)? Responde ÚNICAMENTE con un JSON válido, sin texto adicional, con este formato exacto: {\"esCredencial\": true o false, \"vigente\": true o false, \"institucion\": \"nombre o null\", \"motivo\": \"breve explicación\"}"
              },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${imageB64}` }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Error Groq Vision:", errText);
      return res.status(500).json({ ok: false, reply: "No se pudo analizar la credencial. Intenta de nuevo." });
    }

    const groqData = await groqRes.json();
    const rawContent = groqData.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const cleaned = rawContent.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("Error parseando respuesta de Groq:", rawContent);
      return res.status(500).json({ ok: false, reply: "No se pudo verificar la credencial. Intenta con una foto más clara." });
    }

    if (!parsed.esCredencial || !parsed.vigente) {
      return res.json({
        ok: false,
        approved: false,
        reply: parsed.motivo || "No se pudo validar la credencial como vigente. Asegúrate de que se vea completa y legible."
      });
    }

    // Aprobado: guardar descuento de estudiante por 3 meses
    const now = new Date();
    const expira = new Date(now);
    expira.setMonth(expira.getMonth() + 3);

    await db.upsertUser(uid, {
      studentDiscount: true,
      studentDiscountExpires: expira.toISOString(),
      studentDiscountInstitution: parsed.institucion || null
    });

    return res.json({
      ok: true,
      approved: true,
      expires: expira.toISOString(),
      reply: "¡Credencial verificada! Tu descuento de estudiante (25%) está activo por 3 meses."
    });

  } catch (error) {
    console.error("Error en /api/verify-student:", error);
    res.status(500).json({ ok: false, reply: "Error verificando la credencial. Intenta de nuevo." });
  }
}
