import { stripe, db } from "./_lib.js";

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig     = req.headers["stripe-signature"];
  const rawBody = await getRawBody(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session  = event.data.object;
        const userId   = session.metadata?.userId || session.metadata?.firebaseUID;
        const plan     = session.metadata?.plan || "go";
        if (!userId) break;

        const data = {
          premium: true, plan,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          email: session.customer_email,
          premiumSince: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription);
            data.currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
          } catch (_) {}
        }

        await db.collection("users").doc(userId).set(data, { merge: true });
        break;
      }

      case "customer.subscription.deleted": {
        const sub  = event.data.object;
        const snap = await db.collection("users").where("stripeCustomerId", "==", sub.customer).get();
        const batch = db.batch();
        snap.forEach(d => batch.update(d.ref, { premium: false, plan: "free", subscriptionStatus: "canceled", canceledAt: new Date().toISOString() }));
        await batch.commit();
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
