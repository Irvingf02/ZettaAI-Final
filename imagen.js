import { setCors, getUserPlan, PLAN_CONFIG } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { prompt, uid } = req.body;
  if (!prompt) return res.status(400).json({ reply: "Describe la imagen que quieres crear." });

  const { plan } = await getUserPlan(uid);
  const planCfg  = PLAN_CONFIG[plan] || PLAN_CONFIG.free;

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: planCfg.imgSize, quality: planCfg.imgQuality })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ reply: "Error generando imagen: " + (err.error?.message || "desconocido") });
    }

    const data = await response.json();
    res.json({ imageUrl: data.data[0].url, plan });

  } catch (error) {
    res.status(500).json({ reply: "Error generando imagen. Intenta de nuevo." });
  }
}
