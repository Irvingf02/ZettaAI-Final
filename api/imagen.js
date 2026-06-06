import { setCors, getUserPlan, verifyApiKey  } from "./_lib.js";

function hashPrompt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { prompt, uid, imageUrl: editImageUrl, maskB64 } = req.body;
  if (!prompt) return res.status(400).json({ reply: "Describe la imagen que quieres crear." });
  if (!verifyApiKey(req)) return res.status(401).json({ reply: "No autorizado." });
  const { plan } = await getUserPlan(uid);

  // ── Seleccionar áreas: edición con Stable Diffusion Inpainting ──
  if (editImageUrl) {
    try {
      // Descargar imagen desde la URL (el backend no tiene restricción CORS)
      const imgRes = await fetch(editImageUrl);
      if (!imgRes.ok) throw new Error("No se pudo descargar la imagen");
      const imgBuffer = await imgRes.arrayBuffer();
      const imageB64 = Buffer.from(imgBuffer).toString("base64");

      const sdRes = await fetch("https://irving02-zettax-inpainting.hf.space/run/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: [
            imageB64,
            maskB64 || "",
            prompt
          ]
        })
      });

      if (!sdRes.ok) throw new Error("Error en Stable Diffusion");

      const sdData = await sdRes.json();
      const resultB64 = sdData.data?.[0];
      if (!resultB64) throw new Error("No se recibió imagen");

      const imageUrl = `data:image/png;base64,${resultB64}`;
      return res.json({ imageUrl, plan });
    } catch (error) {
      return res.status(500).json({ reply: "Error editando imagen. Intenta de nuevo." });
    }
  }

  // ── Generación normal con Pollinations (sin tocar) ──
  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "You are an expert at writing image generation prompts. Convert the user's request into a detailed, precise English prompt for an image generator. Be very specific about what should appear in the image. Only respond with the prompt, nothing else."
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 200,
        temperature: 0
      })
    });

    let enhancedPrompt = prompt;
    if (groqRes.ok) {
      const groqData = await groqRes.json();
      enhancedPrompt = groqData.choices?.[0]?.message?.content || prompt;
    }

    // Seed basado en el prompt para consistencia
    const seed = hashPrompt(enhancedPrompt);
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;

    res.json({ imageUrl, plan });
  } catch (error) {
    res.status(500).json({ reply: "Error generando imagen. Intenta de nuevo." });
  }
}