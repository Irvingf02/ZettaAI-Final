import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import Stripe from "stripe";
import bodyParser from "body-parser";
import admin from "firebase-admin";

// ── 1. FIREBASE ADMIN ─────────────────────────────────────────────────────────
// En Railway usa variable de entorno. En local usa el archivo JSON.
let serviceAccount;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
} else {
  const { readFileSync } = await import("fs");
  serviceAccount = JSON.parse(readFileSync("./serviceAccountKey.json"));
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── 2. STRIPE ─────────────────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── 3. MODOS DE IA ────────────────────────────────────────────────────────────
const MODOS_IA = {
  chat: {
    system: "Eres Mi IA PRO. Respuestas cortas y directas (máximo 2 oraciones). Sin rellenos.",
    tokens: 150,
    temp: 0.5,
    premium: false   // gratis
  },
  resumen: {
    system: "Eres un experto en síntesis. Resume el texto en puntos clave muy breves.",
    tokens: 300,
    temp: 0.3,
    premium: true    // solo premium
  },
  ideas: {
    system: "Eres un generador creativo. Da ideas originales, disruptivas y accionables.",
    tokens: 400,
    temp: 0.9,
    premium: true
  },
  tarea: {
    system: "Eres un tutor para estudiantes. Explica con analogías simples y ejemplos claros.",
    tokens: 500,
    temp: 0.7,
    premium: true
  }
};

// ── 4. RATE LIMITER MANUAL (sin dependencias extra) ───────────────────────────
// Guarda intentos por IP en memoria
const rateLimitMap = new Map();
const RATE_LIMIT_MAX      = 10;   // máx mensajes gratis por ventana
const RATE_LIMIT_WINDOW   = 60 * 60 * 1000; // 1 hora en ms
const RATE_LIMIT_PREMIUM  = 100;  // mensajes premium por hora

function getRateKey(ip, uid) {
  return uid ? `user:${uid}` : `ip:${ip}`;
}

function checkRateLimit(key, isPremium) {
  const now     = Date.now();
  const limit   = isPremium ? RATE_LIMIT_PREMIUM : RATE_LIMIT_MAX;
  const entry   = rateLimitMap.get(key) || { count: 0, start: now };

  // Resetear ventana si pasó la hora
  if (now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(key, { count: 1, start: now });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW - (now - entry.start)) / 60000);
    return { allowed: false, resetIn };
  }

  entry.count++;
  rateLimitMap.set(key, entry);
  return { allowed: true, remaining: limit - entry.count };
}

// Limpiar el mapa cada hora para evitar memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now - val.start > RATE_LIMIT_WINDOW) rateLimitMap.delete(key);
  }
}, RATE_LIMIT_WINDOW);

// ── 5. EXPRESS ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());

// ── 6. WEBHOOK STRIPE (antes de express.json) ─────────────────────────────────
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Pago exitoso → marcar Premium
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId  = session.metadata.userId;
    const email   = session.customer_email;

    try {
      await db.collection("users").doc(userId).set(
        { premium: true, email, premiumSince: new Date().toISOString() },
        { merge: true }
      );
      console.log(`⭐ Premium activado: ${email}`);
    } catch (err) {
      console.error("❌ Error Firestore:", err.message);
    }
  }

  // Suscripción cancelada → quitar Premium
  if (event.type === "customer.subscription.deleted") {
    const customerId = event.data.object.customer;
    try {
      const snap = await db.collection("users")
        .where("stripeCustomerId", "==", customerId).get();
      const batch = db.batch();
      snap.forEach(d => batch.update(d.ref, { premium: false }));
      await batch.commit();
      console.log(`🚫 Premium removido: ${customerId}`);
    } catch (err) {
      console.error("❌ Error removiendo Premium:", err.message);
    }
  }

  res.json({ received: true });
});

// ── 7. JSON MIDDLEWARE ────────────────────────────────────────────────────────
app.use(express.json());

// ── 8. HEALTH CHECK ───────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── 9. RUTA DE CHAT (con rate limit + verificación premium + historial) ────────
app.post("/chat", async (req, res) => {
  const { message, mode, history, uid } = req.body;

  if (!message) {
    return res.status(400).json({ reply: "Escribe algo primero." });
  }

  const ip         = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  const modoConfig = MODOS_IA[mode] || MODOS_IA.chat;

  // ── Verificar Premium en backend (no confiar solo en el frontend) ──
  let isPremium = false;
  if (uid) {
    try {
      const snap = await db.collection("users").doc(uid).get();
      isPremium = snap.exists && snap.data().premium === true;
    } catch (e) {
      console.error("Error verificando premium:", e.message);
    }
  }

  // Bloquear modos premium si no tiene suscripción
  if (modoConfig.premium && !isPremium) {
    return res.status(403).json({
      reply: "🔒 Esta función es exclusiva para usuarios Premium.",
      requiresPremium: true
    });
  }

  // ── Rate limit ────────────────────────────────────────────────────
  const rateKey = getRateKey(ip, uid);
  const rate    = checkRateLimit(rateKey, isPremium);

  if (!rate.allowed) {
    return res.status(429).json({
      reply: `⏳ Límite alcanzado. Intenta de nuevo en ${rate.resetIn} minutos.`,
      rateLimited: true
    });
  }

  // ── Construir historial para memoria ──────────────────────────────
  // El frontend manda los últimos N mensajes para darle contexto a la IA
  const messages = [
    { role: "system", content: modoConfig.system }
  ];

  // Agregar historial previo (máximo 6 turnos = 12 mensajes para no gastar tokens)
  if (Array.isArray(history) && history.length > 0) {
    const maxTurns = isPremium ? 10 : 4; // premium tiene más memoria
    const recent   = history.slice(-maxTurns * 2);
    messages.push(...recent);
  }

  messages.push({ role: "user", content: message });

  // ── Llamada a OpenAI ──────────────────────────────────────────────
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        max_tokens:  modoConfig.tokens,
        temperature: modoConfig.temp
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        reply: "Error de OpenAI: " + (err.error?.message || "desconocido")
      });
    }

    const data  = await response.json();
    const reply = data.choices[0].message.content;

    res.json({
      reply,
      remaining: rate.remaining,
      isPremium
    });

  } catch (error) {
    console.error("❌ Error en /chat:", error.message);
    res.status(500).json({ reply: "Error interno. Intenta de nuevo." });
  }
});
// ── 10. CREAR SESIÓN DE PAGO (ACTUALIZADO PARA 3 PLANES) ──────────────────────
app.post("/create-checkout-session", async (req, res) => {
  const { email, userId, plan } = req.body; // Recibimos 'plan' desde el frontend

  if (!email || !userId) {
    return res.status(400).json({ error: "Se requiere email y userId." });
  }

  // 1. Elegir el ID del precio según el plan seleccionado
  let priceId;
  if (plan === "plus") {
    priceId = process.env.STRIPE_PRICE_ID_PLUS;
  } else if (plan === "ultra") {
    priceId = process.env.STRIPE_PRICE_ID_ULTRA;
  } else {
    priceId = process.env.STRIPE_PRICE_ID_GO; // Plan por defecto (el de 100)
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: email,
      // 2. Usamos el priceId que elegimos arriba
      line_items: [{ price: priceId, quantity: 1 }], 
      metadata: { userId },
      // Asegúrate de que FRONTEND_URL en tu .env sea http://localhost:5500 (o tu IP)
      // Sustituye process.env.FRONTEND_URL por tu link de Vercel entre comillas
      success_url: `https://zetta-ai-pnhu.vercel.app?success=true`,
      cancel_url:  `https://zetta-ai-pnhu.vercel.app?cancel=true`

    });

    // Guardar el Customer ID de Stripe en Firebase para futuras cancelaciones
    if (session.customer) {
      await db.collection("users").doc(userId).set(
        { stripeCustomerId: session.customer },
        { merge: true }
      );
    }

    res.json({ url: session.url });

  } catch (e) {
    console.error("❌ Error pago:", e.message);
    res.status(500).json({ error: e.message });
  }
});
// ── 11. VERIFICAR ESTADO DEL USUARIO ──────────────────────────────────────────
app.get("/user-status/:userId", async (req, res) => {
  try {
    const snap = await db.collection("users").doc(req.params.userId).get();
    if (!snap.exists) return res.json({ premium: false, messagesUsed: 0 });
    const data = snap.data();
    res.json({ premium: data.premium || false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 12. INICIAR SERVIDOR ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});