import { setCors, getUserPlan, PLAN_CONFIG, MODOS_IA } from "./_lib.js";

const RATE_LIMITS = { free: 30, go: 300, plus: 600, ultra: 2000 };
const rateLimitMap = new Map();

// Modelos de Groq por plan
const GROQ_MODELS = {
  free:  "llama3-8b-8192",
  go:    "llama3-8b-8192",
  plus:  "llama-3.3-70b-versatile",
  ultra: "llama-3.3-70b-versatile"
};

function checkRateLimit(key, plan) {
  const now   = Date.now();
  const limit = RATE_LIMITS[plan] || 30;
  const WINDOW = 60 * 60 * 1000;
  const entry = rateLimitMap.get(key) || { count: 0, start: now };
  if (now - entry.start > WINDOW) {
    rateLimitMap.set(key, { count: 1, start: now });
    return { allowed: true, remaining: limit - 1 };
  }
  if (entry.count >= limit) {
    return { allowed: false, resetIn: Math.ceil((WINDOW - (now - entry.start)) / 60000) };
  }
  entry.count++;
  rateLimitMap.set(key, entry);
  return { allowed: true, remaining: limit - entry.count };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { message, mode, history, uid } = req.body;
  if (!message) return res.status(400).json({ reply: "Escribe algo primero." });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  const { isPremium, plan } = await getUserPlan(uid);
  const planCfg = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const modoCfg = MODOS_IA[mode]    || MODOS_IA.chat;

  const rateKey = uid ? `user:${uid}` : `ip:${ip}`;
  const rate    = checkRateLimit(rateKey, plan);
  if (!rate.allowed) {
    return res.status(429).json({
      reply: `⏳ Límite alcanzado. Intenta de nuevo en ${rate.resetIn} minutos.`,
      rateLimited: true
    });
  }

  const suffix       = (mode === "codigo" && planCfg.codeSuffix) ? planCfg.codeSuffix : planCfg.systemSuffix;
  const systemPrompt = `${modoCfg.system} ${suffix}`;
  const messages     = [{ role: "system", content: systemPrompt }];

  if (Array.isArray(history) && history.length > 0) {
    messages.push(...history.slice(-(planCfg.memory * 2)));
  }
  messages.push({ role: "user", content: message });

  const groqModel = GROQ_MODELS[plan] || GROQ_MODELS.free;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        model: groqModel,
        messages,
        max_tokens: planCfg.maxTokens,
        temperature: planCfg.temp
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ reply: "Error de Groq: " + (err.error?.message || "desconocido") });
    }

    const data = await response.json();
    res.json({ reply: data.choices[0].message.content, remaining: rate.remaining, isPremium, plan });

  } catch (error) {
    res.status(500).json({ reply: "Error interno. Intenta de nuevo." });
  }
}
