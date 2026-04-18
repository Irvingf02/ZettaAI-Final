import Stripe from "stripe";

// ── STRIPE ────────────────────────────────────────────────────────────────────
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── CORS ──────────────────────────────────────────────────────────────────────
export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin",      "https://zettax-ai-pnhu.vercel.app");
  res.setHeader("Access-Control-Allow-Methods",     "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers",     "Content-Type, Authorization, stripe-signature");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

// ── REALTIME DATABASE REST API ────────────────────────────────────────────────
const RTDB_URL = "https://zettaai-f26f9-default-rtdb.firebaseio.com";

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiry - 60) return cachedToken;

  const sa = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");

  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
  const unsigned = `${encode({alg:"RS256",typ:"JWT"})}.${encode({
    iss: sa.client_email, sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email"
  })}`;

  const keyData = sa.private_key.replace(/-----[^-]+-----/g,"").replace(/\n/g,"");
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryKey.buffer, {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}`
  });
  const json = await tokenRes.json();
  
  if (json.access_token) {
    cachedToken = json.access_token;
    tokenExpiry = now + 3600;
    return cachedToken;
  }
  
  console.error("Error getting token:", json);
  return null;
}

export const db = {
  async get(path) {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch(`${RTDB_URL}/${path}.json?access_token=${token}`);
    const data = await res.json();
    if (data && data.error) { console.error("RTDB get error:", data.error); return null; }
    return data;
  },
  async set(path, data) {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch(`${RTDB_URL}/${path}.json?access_token=${token}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json && json.error) console.error("RTDB set error:", json.error);
  },
  async update(path, data) {
    const token = await getAccessToken();
    if (!token) return;
    const res = await fetch(`${RTDB_URL}/${path}.json?access_token=${token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json && json.error) console.error("RTDB update error:", json.error);
  }
};

// ── PLAN CONFIG ───────────────────────────────────────────────────────────────
export const PLAN_CONFIG = {
  free:  { model: "gpt-4o-mini", maxTokens: 300,  temp: 0.6,  memory: 4,  imgQuality: "standard", imgSize: "1024x1024", systemSuffix: "Sé conciso. Máximo 3 oraciones por respuesta.", codeSuffix: "Genera código funcional y breve. Sin comentarios extensos. Máximo 50 líneas." },
  go:    { model: "gpt-4o-mini", maxTokens: 800,  temp: 0.65, memory: 8,  imgQuality: "standard", imgSize: "1024x1024", systemSuffix: "Da respuestas completas y bien estructuradas.", codeSuffix: "Genera código limpio con comentarios. Máximo 150 líneas." },
  plus:  { model: "gpt-4o",      maxTokens: 1800, temp: 0.7,  memory: 14, imgQuality: "hd",       imgSize: "1024x1024", systemSuffix: "Da respuestas detalladas y con ejemplos prácticos.", codeSuffix: "Genera código profesional. Máximo 300 líneas." },
  ultra: { model: "gpt-4o",      maxTokens: 4000, temp: 0.75, memory: 20, imgQuality: "hd",       imgSize: "1792x1024", systemSuffix: "Eres la versión más avanzada de ZettaxAI. Da respuestas exhaustivas.", codeSuffix: "Genera código de arquitectura profesional sin límite de líneas." }
};

export const MODOS_IA = {
  chat:    { system: "Eres ZettaxAI, un asistente inteligente, amigable y directo." },
  resumen: { system: "Eres ZettaxAI especializado en síntesis. Resume textos en puntos clave claros." },
  ideas:   { system: "Eres ZettaxAI generador de ideas. Proporciona ideas originales y accionables." },
  tarea:   { system: "Eres ZettaxAI tutor educativo. Explica conceptos con analogías simples y pasos claros." },
  codigo:  { system: "Eres ZettaxAI experto en programación. Escribe código limpio y funcional." }
};

export async function getUserPlan(uid) {
  if (!uid) return { isPremium: false, plan: "free" };
  try {
    const data = await db.get(`users/${uid}`);
    if (!data) return { isPremium: false, plan: "free" };
    const plan = data.plan || (data.premium === true ? "go" : "free");
    return { isPremium: plan !== "free", plan };
  } catch (e) {
    return { isPremium: false, plan: "free" };
  }
}