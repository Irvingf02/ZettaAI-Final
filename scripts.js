import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import Stripe from "stripe";
import bodyParser from "body-parser";
import admin from "firebase-admin";

// ── 1. FIREBASE ADMIN ─────────────────────────────────────────────────────────

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

// ── 3. CALIDAD POR PLAN ───────────────────────────────────────────────────────
const PLAN_CONFIG = {
  free: {
    model:        "gpt-4o-mini",
    maxTokens:    300,
    temp:         0.6,
    memory:       4,
    imgQuality:   "standard",
    imgSize:      "1024x1024",
    systemSuffix: "Sé conciso. Máximo 3 oraciones por respuesta.",
    codeSuffix:   "Genera código funcional y breve. Sin comentarios extensos. Máximo 50 líneas."
  },
  go: {
    model:        "gpt-4o-mini",
    maxTokens:    800,
    temp:         0.65,
    memory:       8,
    imgQuality:   "standard",
    imgSize:      "1024x1024",
    systemSuffix: "Da respuestas completas y bien estructuradas. Usa ejemplos cuando ayuden.",
    codeSuffix:   "Genera código limpio con comentarios claros en cada función. Incluye un ejemplo de uso. Máximo 150 líneas."
  },
  plus: {
    model:        "gpt-4o",
    maxTokens:    1800,
    temp:         0.7,
    memory:       14,
    imgQuality:   "hd",
    imgSize:      "1024x1024",
    systemSuffix: "Da respuestas detalladas, bien organizadas y con ejemplos prácticos. Usa listas y estructura cuando sea útil.",
    codeSuffix:   "Genera código profesional con comentarios detallados, manejo de errores, buenas prácticas y pruebas básicas. Explica decisiones de diseño. Máximo 300 líneas."
  },
  ultra: {
    model:        "gpt-4o",
    maxTokens:    4000,
    temp:         0.75,
    memory:       20,
    imgQuality:   "hd",
    imgSize:      "1792x1024",
    systemSuffix: "Eres la versión más avanzada de ZettaxAI. Da respuestas exhaustivas, profundas y de máxima calidad. Usa estructura clara, ejemplos reales, y agrega valor más allá de lo que se pide.",
    codeSuffix:   "Genera código de arquitectura profesional: modular, escalable, con patrones de diseño, manejo de errores robusto, pruebas unitarias, documentación JSDoc/docstring y optimización de rendimiento. Explica cada decisión técnica. Sin límite de líneas."
  }
};

// ── 4. PROMPTS POR MODO ───────────────────────────────────────────────────────
const MODOS_IA = {
  chat: {
    system: "Eres ZettaxAI, un asistente inteligente, amigable y directo."
  },
  resumen: {
    system: "Eres ZettaxAI especializado en síntesis. Resume textos en puntos clave claros, ordenados y fáciles de entender. Destaca siempre lo más importante."
  },
  ideas: {
    system: "Eres ZettaxAI generador de ideas. Proporciona ideas originales, creativas, disruptivas y accionables. Numera cada idea y explica brevemente cómo ejecutarla."
  },
  tarea: {
    system: "Eres ZettaxAI tutor educativo. Explica conceptos con analogías simples, ejemplos cotidianos y pasos claros. Adapta tu lenguaje al nivel del estudiante."
  },
  codigo: {
    system: "Eres ZettaxAI experto en programación. Escribe código limpio, bien comentado y funcional. Explica brevemente qué hace el código. Si hay errores, corrígelos y explica por qué. Usa el lenguaje que el usuario indique o el más adecuado."
  }
};

// ── 5. OBTENER PLAN DEL USUARIO ───────────────────────────────────────────────
async function getUserPlan(uid) {
  if (!uid) return { isPremium: false, plan: "free" };
  try {
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return { isPremium: false, plan: "free" };
    const data = snap.data();
    const plan = data.plan || (data.premium === true ? "go" : "free");
    return { isPremium: plan !== "free", plan };
  } catch (e) {
    console.error("Error obteniendo plan:", e.message);
    return { isPremium: false, plan: "free" };
  }
}

// ── 6. RATE LIMITER ───────────────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_WINDOW  = 60 * 60 * 1000;

const RATE_LIMITS = {
  free:  30,
  go:    300,
  plus:  600,
  ultra: 2000
};

function getRateKey(ip, uid) {
  return uid ? `user:${uid}` : `ip:${ip}`;
}

function checkRateLimit(key, plan) {
  const now   = Date.now();
  const limit = RATE_LIMITS[plan] || RATE_LIMITS.free;
  const entry = rateLimitMap.get(key) || { count: 0, start: now };

  if (now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(key, { count: 1, start: now });
    return { allowed: true, remaining: limit - 1 };
  }
  if (entry.count >= limit) {
    const resetIn = Math.ceil((RATE_WINDOW - (now - entry.start)) / 60000);
    return { allowed: false, resetIn };
  }
  entry.count++;
  rateLimitMap.set(key, entry);
  return { allowed: true, remaining: limit - entry.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now - val.start > RATE_WINDOW) rateLimitMap.delete(key);
  }
}, RATE_WINDOW);

// ── 7. EXPRESS ────────────────────────────────────────────────────────────────
const app = express();

// ── CORS manual ───────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const allowed = [
    "https://zettax-ai-pnhu.vercel.app",
    "http://localhost:3000",
    "http://localhost:5500"
  ];
  const origin = req.headers.origin;
  if (!origin || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods",     "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers",     "Content-Type, Authorization, stripe-signature");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── 8. WEBHOOK STRIPE (CORREGIDO) ─────────────────────────────────────────────
app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📩 Webhook recibido: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        
        const userId = session.metadata?.userId || session.metadata?.firebaseUID;
        const plan = session.metadata?.plan || 'go';

        if (!userId) {
          console.error("❌ No se encontró userId en metadata");
          return res.status(400).json({ error: "No userId in metadata" });
        }

        const subscriptionId = session.subscription;
        const subscriptionData = {
          premium: true,
          plan: plan,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: subscriptionId,
          email: session.customer_email,
          premiumSince: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            subscriptionData.currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
          } catch (subErr) {
            console.warn("⚠️ No se pudo obtener detalles de suscripción:", subErr.message);
          }
        }

        await db.collection("users").doc(userId).set(subscriptionData, { merge: true });
        console.log(`⭐ Plan [${plan}] activado para: ${userId}`);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        const usersSnap = await db.collection("users")
          .where("stripeCustomerId", "==", customerId)
          .limit(1)
          .get();
          
        if (!usersSnap.empty) {
          const userDoc = usersSnap.docs[0];
          const priceId = subscription.items.data[0]?.price.id;
          
          let plan = 'go';
          if (priceId === process.env.STRIPE_PRICE_ID_PLUS) plan = 'plus';
          else if (priceId === process.env.STRIPE_PRICE_ID_ULTRA) plan = 'ultra';
          
          await userDoc.ref.update({
            plan: plan,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
            updatedAt: new Date().toISOString()
          });
          console.log(`🔄 Plan actualizado a [${plan}]`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        
        const snap = await db.collection("users")
          .where("stripeCustomerId", "==", customerId)
          .get();
          
        const batch = db.batch();
        snap.forEach(d => {
          batch.update(d.ref, { 
            premium: false, 
            plan: "free",
            subscriptionStatus: 'canceled',
            canceledAt: new Date().toISOString()
          });
        });
        
        await batch.commit();
        console.log(`🚫 Plan removido: ${customerId}`);
        break;
      }

      default:
        console.log(`ℹ️ Evento no manejado: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("❌ Error procesando webhook:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── 9. JSON MIDDLEWARE ────────────────────────────────────────────────────────
app.use(express.json());

// ── 10. HEALTH CHECK ──────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── 11. RUTA /chat ────────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { message, mode, history, uid } = req.body;

  if (!message) {
    return res.status(400).json({ reply: "Escribe algo primero." });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;

  const { isPremium, plan } = await getUserPlan(uid);
  const planCfg = PLAN_CONFIG[plan] || PLAN_CONFIG.free;
  const modoCfg = MODOS_IA[mode]    || MODOS_IA.chat;

  const rateKey = getRateKey(ip, uid);
  const rate    = checkRateLimit(rateKey, plan);
  if (!rate.allowed) {
    return res.status(429).json({
      reply: `⏳ Límite alcanzado. Intenta de nuevo en ${rate.resetIn} minutos.`,
      rateLimited: true
    });
  }

  const suffix = (mode === "codigo" && planCfg.codeSuffix) ? planCfg.codeSuffix : planCfg.systemSuffix;
  const systemPrompt = `${modoCfg.system} ${suffix}`;

  const messages = [{ role: "system", content: systemPrompt }];

  if (Array.isArray(history) && history.length > 0) {
    const recent = history.slice(-(planCfg.memory * 2));
    messages.push(...recent);
  }

  messages.push({ role: "user", content: message });

try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model:       planCfg.model,
        messages,
        max_tokens:  planCfg.maxTokens,
        temperature: planCfg.temp
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

    res.json({ reply, remaining: rate.remaining, isPremium, plan });

  } catch (error) {
    console.error("❌ Error en /chat:", error.message);
    res.status(500).json({ reply: "Error interno. Intenta de nuevo." });
  }
});

// ── 12. RUTA /imagen ──────────────────────────────────────────────────────────
app.post("/imagen", async (req, res) => {
  const { prompt, uid } = req.body;

  if (!prompt) {
    return res.status(400).json({ reply: "Describe la imagen que quieres crear." });
  }

  const { isPremium, plan } = await getUserPlan(uid);
  const planCfg = PLAN_CONFIG[plan] || PLAN_CONFIG.free;

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model:   "dall-e-3",
        prompt,
        n:       1,
        size:    planCfg.imgSize,
        quality: planCfg.imgQuality
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        reply: "Error generando imagen: " + (err.error?.message || "desconocido")
      });
    }

    const data     = await response.json();
    const imageUrl = data.data[0].url;

    res.json({ imageUrl, plan });

  } catch (error) {
    console.error("❌ Error en /imagen:", error.message);
    res.status(500).json({ reply: "Error generando imagen. Intenta de nuevo." });
  }
});

// ── 13. CREAR SESIÓN DE PAGO ──────────────────────────────────────────────────
app.post("/play", async (req, res) => {
  const { email, userId, plan } = req.body;

  if (!email || !userId) {
    return res.status(400).json({ error: "Se requiere email y userId." });
  }

  // Validar que FRONTEND_URL esté configurado
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) {
    console.error("❌ FRONTEND_URL no está definido en variables de entorno.");
    return res.status(500).json({ error: "Configuración del servidor incompleta (FRONTEND_URL)." });
  }

  const validPlans = ['go', 'plus', 'ultra'];
  const selectedPlan = validPlans.includes(plan) ? plan : 'go';

  let priceId;
  if (selectedPlan === "plus")       priceId = process.env.STRIPE_PRICE_ID_PLUS;
  else if (selectedPlan === "ultra") priceId = process.env.STRIPE_PRICE_ID_ULTRA;
  else                               priceId = process.env.STRIPE_PRICE_ID_GO;

  if (!priceId) {
    console.error(`❌ Price ID no configurado para plan: ${selectedPlan}`);
    return res.status(500).json({ error: `Price ID no configurado para el plan "${selectedPlan}". Revisa las variables de entorno STRIPE_PRICE_ID_GO / STRIPE_PRICE_ID_PLUS / STRIPE_PRICE_ID_ULTRA.` });
  }

  try {
    let customer;
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      await stripe.customers.update(customer.id, {
        metadata: { firebaseUID: userId, plan: selectedPlan }
      });
    } else {
      customer = await stripe.customers.create({
        email,
        metadata: { firebaseUID: userId, plan: selectedPlan }
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { 
        userId: userId, 
        plan: selectedPlan,
        firebaseUID: userId 
      },
      subscription_data: {
        metadata: {
          userId: userId,
          plan: selectedPlan,
          firebaseUID: userId
        }
      },
      success_url: `${frontendUrl}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}?cancel=true`
    });

    await db.collection("users").doc(userId).set(
      { 
        stripeCustomerId: customer.id,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );

    res.json({ url: session.url });

  } catch (e) {
    console.error("❌ Error creando sesión Stripe:", e);
    // Stripe devuelve errores con e.type y e.message más descriptivos
    const mensaje = e?.raw?.message || e?.message || "Error desconocido al crear sesión de pago.";
    res.status(500).json({ error: mensaje });
  }
});

// ── 14. ESTADO DEL USUARIO ────────────────────────────────────────────────────
app.get("/user-status/:userId", async (req, res) => {
  try {
    const snap = await db.collection("users").doc(req.params.userId).get();
    if (!snap.exists) return res.json({ premium: false, plan: "free" });
    const data = snap.data();
    res.json({ 
      premium: data.premium || false, 
      plan: data.plan || "free",
      status: data.subscriptionStatus || 'inactive'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 15. INICIAR SERVIDOR ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
});