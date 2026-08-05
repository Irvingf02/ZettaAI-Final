import { setCors, getUserPlan, PLAN_CONFIG, MODOS_IA, verifyApiKey, verifyOrigin } from "./_lib.js";

const RATE_LIMITS = { free: 30, go: 300, plus: 600, ultra: 2000 };

// Búsqueda web con Serper.dev (solo para modo chat)
async function webSearch(query) {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ q: query, num: 5, hl: "es" })
    });
    if (!res.ok) return "";
    const data = await res.json();
    const snippets = (data.organic || []).map(r => `${r.title}: ${r.snippet}`).join("\n");
    return snippets;
  } catch (e) {
    return "";
  }
}

const rateLimitMap = new Map();

// Todos los planes usan el modelo más preciso
// Modelos por plan
const MODEL_CONFIG = {
  free:  { provider: "groq", model: "llama-3.3-70b-versatile" },
  go:    { provider: "zai",  model: "glm-4.7-flash" },
  plus:  { provider: "zai",  model: "glm-5.1" },
  ultra: { provider: "zai",  model: "glm-5.2" }
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
  if (!verifyApiKey(req) || !verifyOrigin(req)) return res.status(401).json({ reply: "No autorizado." });
  if (typeof message !== "string" || message.length > 10000) return res.status(400).json({ reply: "Mensaje inválido." });
  if (uid && (typeof uid !== "string" || uid.length > 128)) return res.status(400).json({ reply: "Usuario inválido." });
  if (mode && !["chat","resumen","ideas","tarea","codigo","imagen"].includes(mode)) return res.status(400).json({ reply: "Modo inválido." });
  
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

  // Búsqueda web solo en modo chat
  let searchContext = "";
  if (!mode || mode === "chat") {
    const searchResults = await webSearch(message);
    if (searchResults) {
      searchContext = `\n\nInformación actualizada de la web (úsala si es relevante para responder):\n${searchResults}`;
    }
  }

  const suffix       = (mode === "codigo" && planCfg.codeSuffix) ? planCfg.codeSuffix : planCfg.systemSuffix;
  const systemPrompt = `${modoCfg.system} ${suffix}${searchContext}`;
  const messages     = [{ role: "system", content: systemPrompt }];

  if (Array.isArray(history) && history.length > 0) {
    messages.push(...history.slice(-(planCfg.memory * 2)));
  }
  messages.push({ role: "user", content: message });

 const { provider, model } = MODEL_CONFIG[plan] || MODEL_CONFIG.free;
  const apiUrl = provider === "zai"
    ? "https://api.z.ai/api/openai/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const apiKey = provider === "zai"
    ? process.env.ZAI_API_KEY
    : process.env.GROQ_API_KEY;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: planCfg.maxTokens,
        temperature: planCfg.temp
      })
    });
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ reply: "Error de Modelo: " + (err.error?.message || "desconocido") });
    }

    const data = await response.json();
    res.json({ reply: data.choices[0].message.content, remaining: rate.remaining, isPremium, plan });

  } catch (error) {
    res.status(500).json({ reply: "Error interno. Intenta de nuevo." });
  }
}
