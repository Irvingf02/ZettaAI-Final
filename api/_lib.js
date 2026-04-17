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

// ── FIREBASE REST API ─────────────────────────────────────────────────────────
const PROJECT_ID = "zettaai-1c02a";
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getAccessToken() {
  const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore"
  };

  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsigned = `${encode(header)}.${encode(payload)}`;

  const keyData = serviceAccount.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(unsigned)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${unsigned}.${sig}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

function toFirestore(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string")   fields[k] = { stringValue: v };
    else if (typeof v === "number")  fields[k] = { integerValue: String(v) };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
  }
  return { fields };
}

function fromFirestore(doc) {
  if (!doc.fields) return {};
  const obj = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    if (v.stringValue  !== undefined) obj[k] = v.stringValue;
    else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
    else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
  }
  return obj;
}

export const db = {
  collection: (col) => ({
    doc: (docId) => ({
      async get() {
        const token = await getAccessToken();
        const res = await fetch(`${FIRESTORE_URL}/${col}/${docId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 404) return { exists: false, data: () => ({}) };
        const json = await res.json();
        return { exists: true, data: () => fromFirestore(json) };
      },
      async set(data, opts = {}) {
        const token = await getAccessToken();
        const url = opts.merge
          ? `${FIRESTORE_URL}/${col}/${docId}?${Object.keys(data).map(k=>`updateMask.fieldPaths=${k}`).join("&")}`
          : `${FIRESTORE_URL}/${col}/${docId}`;
        await fetch(url, {
          method: opts.merge ? "PATCH" : "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(toFirestore(data))
        });
      }
    }),
    where() { return { async get() { return { forEach: () => {} }; } }; }
  })
};

export const PLAN_CONFIG = {
  free:  { model: "gpt-4o-mini", maxTokens: 300,  temp: 0.6,  memory: 4,  imgQuality: "standard", imgSize: "1024x1024", systemSuffix: "Sé conciso. Máximo 3 oraciones por respuesta.", codeSuffix: "Genera código funcional y breve. Sin comentarios extensos. Máximo 50 líneas." },
  go:    { model: "gpt-4o-mini", maxTokens: 800,  temp: 0.65, memory: 8,  imgQuality: "standard", imgSize: "1024x1024", systemSuffix: "Da respuestas completas y bien estructuradas. Usa ejemplos cuando ayuden.", codeSuffix: "Genera código limpio con comentarios claros en cada función. Incluye un ejemplo de uso. Máximo 150 líneas." },
  plus:  { model: "gpt-4o",      maxTokens: 1800, temp: 0.7,  memory: 14, imgQuality: "hd",       imgSize: "1024x1024", systemSuffix: "Da respuestas detalladas, bien organizadas y con ejemplos prácticos.", codeSuffix: "Genera código profesional con comentarios detallados. Máximo 300 líneas." },
  ultra: { model: "gpt-4o",      maxTokens: 4000, temp: 0.75, memory: 20, imgQuality: "hd",       imgSize: "1792x1024", systemSuffix: "Eres la versión más avanzada de ZettaxAI. Da respuestas exhaustivas y de máxima calidad.", codeSuffix: "Genera código de arquitectura profesional sin límite de líneas." }
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
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return { isPremium: false, plan: "free" };
    const data = snap.data();
    const plan = data.plan || (data.premium === true ? "go" : "free");
    return { isPremium: plan !== "free", plan };
  } catch (e) {
    return { isPremium: false, plan: "free" };
  }
}