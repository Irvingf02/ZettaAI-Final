import Stripe from "stripe";
import admin from "firebase-admin";

// ── FIREBASE ──────────────────────────────────────────────────────────────────
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
export const db = admin.firestore();

// ── STRIPE ────────────────────────────────────────────────────────────────────
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── CORS ──────────────────────────────────────────────────────────────────────
export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin",      "https://zettax-ai-pnhu.vercel.app");
  res.setHeader("Access-Control-Allow-Methods",     "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers",     "Content-Type, Authorization, stripe-signature");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

// ── PLAN CONFIG ───────────────────────────────────────────────────────────────
export const PLAN_CONFIG = {
  free: {
    model: "gpt-4o-mini", maxTokens: 300, temp: 0.6, memory: 4,
    imgQuality: "standard", imgSize: "1024x1024",
    systemSuffix: "Sé conciso. Máximo 3 oraciones por respuesta.",
    codeSuffix: "Genera código funcional y breve. Sin comentarios extensos. Máximo 50 líneas."
  },
  go: {
    model: "gpt-4o-mini", maxTokens: 800, temp: 0.65, memory: 8,
    imgQuality: "standard", imgSize: "1024x1024",
    systemSuffix: "Da respuestas completas y bien estructuradas. Usa ejemplos cuando ayuden.",
    codeSuffix: "Genera código limpio con comentarios claros en cada función. Incluye un ejemplo de uso. Máximo 150 líneas."
  },
  plus: {
    model: "gpt-4o", maxTokens: 1800, temp: 0.7, memory: 14,
    imgQuality: "hd", imgSize: "1024x1024",
    systemSuffix: "Da respuestas detalladas, bien organizadas y con ejemplos prácticos. Usa listas y estructura cuando sea útil.",
    codeSuffix: "Genera código profesional con comentarios detallados, manejo de errores, buenas prácticas y pruebas básicas. Explica decisiones de diseño. Máximo 300 líneas."
  },
  ultra: {
    model: "gpt-4o", maxTokens: 4000, temp: 0.75, memory: 20,
    imgQuality: "hd", imgSize: "1792x1024",
    systemSuffix: "Eres la versión más avanzada de ZettaxAI. Da respuestas exhaustivas, profundas y de máxima calidad. Usa estructura clara, ejemplos reales, y agrega valor más allá de lo que se pide.",
    codeSuffix: "Genera código de arquitectura profesional: modular, escalable, con patrones de diseño, manejo de errores robusto, pruebas unitarias, documentación JSDoc/docstring y optimización de rendimiento. Explica cada decisión técnica. Sin límite de líneas."
  }
};

// ── MODOS IA ──────────────────────────────────────────────────────────────────
export const MODOS_IA = {
  chat:    { system: "Eres ZettaxAI, un asistente inteligente, amigable y directo." },
  resumen: { system: "Eres ZettaxAI especializado en síntesis. Resume textos en puntos clave claros, ordenados y fáciles de entender. Destaca siempre lo más importante." },
  ideas:   { system: "Eres ZettaxAI generador de ideas. Proporciona ideas originales, creativas, disruptivas y accionables. Numera cada idea y explica brevemente cómo ejecutarla." },
  tarea:   { system: "Eres ZettaxAI tutor educativo. Explica conceptos con analogías simples, ejemplos cotidianos y pasos claros. Adapta tu lenguaje al nivel del estudiante." },
  codigo:  { system: "Eres ZettaxAI experto en programación. Escribe código limpio, bien comentado y funcional. Explica brevemente qué hace el código. Si hay errores, corrígelos y explica por qué. Usa el lenguaje que el usuario indique o el más adecuado." }
};

// ── OBTENER PLAN ──────────────────────────────────────────────────────────────
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
