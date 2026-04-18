import { setCors, getUserPlan } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { prompt, uid } = req.body;
  if (!prompt) return res.status(400).json({ reply: "Describe la imagen que quieres crear." });

  const { plan } = await getUserPlan(uid);

  try {
    // Mejorar el prompt para que Pollinations siga mejor las instrucciones
    const enhancedPrompt = `${prompt}, detailed, accurate, educational, clear illustration, high quality, precise depiction`;
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;

    res.json({ imageUrl, plan });
  } catch (error) {
    res.status(500).json({ reply: "Error generando imagen. Intenta de nuevo." });
  }
}