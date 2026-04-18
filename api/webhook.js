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
        const session = event.data.object;
        const userId  = session.metadata?.userId || session.metadata?.firebaseUID;
        const plan    = session.metadata?.plan || "go";
        if (!userId) break;
        await db.upsertUser(userId, {
          premium: true, plan,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          email: session.customer_email,
          updated_at: new Date().toISOString()
        });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const { data } = await supabase.from("users").select("id").eq("stripe_customer_id", sub.customer);
        if (data) {
          for (const user of data) {
            await db.upsertUser(user.id, { premium: false, plan: "free", updated_at: new Date().toISOString() });
          }
        }
        break;
      }
    }
    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
