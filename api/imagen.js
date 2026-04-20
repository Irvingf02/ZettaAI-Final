import { setCors, getUserPlan } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { prompt, uid } = req.body;
  if (!prompt) return res.status(400).json({ reply: "Describe la imagen que quieres crear." });

  const { plan } = await getUserPlan(uid);

  try {
    // Usar Groq para mejorar el prompt antes de enviarlo a Pollinations
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
        temperature: 0.5
      })
    });

    let enhancedPrompt = prompt;
    if (groqRes.ok) {
      const groqData = await groqRes.json();
      enhancedPrompt = groqData.choices?.[0]?.message?.content || prompt;
    }

    const seed = Math.floor(Math.random() * 1000000);
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;

    res.json({ imageUrl, plan });
  } catch (error) {
    res.status(500).json({ reply: "Error generando imagen. Intenta de nuevo." });
  }
}