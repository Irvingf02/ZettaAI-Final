import Stripe from "stripe";
import admin from "firebase-admin";

// ── FIREBASE ADMIN + FIRESTORE ────────────────────────────────────────────────
if (!admin.apps.length) {
  const sa = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  admin.initializeApp({ credential: admin.credential.cert(sa) });
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
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return { isPremium: false, plan: "free" };
    const data = snap.data();
    const plan = data.plan || (data.premium === true ? "go" : "free");
    return { isPremium: plan !== "free", plan };
  } catch (e) {
    return { isPremium: false, plan: "free" };
  }
}