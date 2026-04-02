import { setCors, stripe, db } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  const { email, userId, plan } = req.body;

  if (!email || !userId) {
    return res.status(400).json({ error: "Se requiere email y userId." });
  }

  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) return res.status(500).json({ error: "FRONTEND_URL no configurado." });

  const validPlans   = ["go", "plus", "ultra"];
  const selectedPlan = validPlans.includes(plan) ? plan : "go";

  let priceId;
  if (selectedPlan === "plus")       priceId = process.env.STRIPE_PRICE_ID_PLUS;
  else if (selectedPlan === "ultra") priceId = process.env.STRIPE_PRICE_ID_ULTRA;
  else                               priceId = process.env.STRIPE_PRICE_ID_GO;

  if (!priceId) {
    return res.status(500).json({ error: `Price ID no configurado para plan "${selectedPlan}".` });
  }

  try {
    // Crear o recuperar cliente en Stripe
    let customer;
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      customer = existing.data[0];
      await stripe.customers.update(customer.id, {
        metadata: { firebaseUID: userId, plan: selectedPlan }
      });
    } else {
      customer = await stripe.customers.create({
        email,
        metadata: { firebaseUID: userId, plan: selectedPlan }
      });
    }

    // Crear sesión — Google Pay aparece automáticamente según el dispositivo
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode:     "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId, plan: selectedPlan, firebaseUID: userId },
      subscription_data: {
        metadata: { userId, plan: selectedPlan, firebaseUID: userId }
      },
      success_url: `${frontendUrl}?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}?cancel=true`
    });

    // Guardar stripeCustomerId en Firebase (no bloquea si falla)
    try {
      await db.collection("users").doc(userId).set(
        { stripeCustomerId: customer.id, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (fbError) {
      console.error("Firebase warning:", fbError.message);
    }

    res.json({ url: session.url });

  } catch (e) {
    console.error("Error en /api/pay:", e);
    const mensaje = e?.raw?.message || e?.message || "Error desconocido.";
    res.status(500).json({ error: mensaje });
  }
}
