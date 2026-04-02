import { setCors, db } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "Se requiere userId." });

  try {
    const snap = await db.collection("users").doc(userId).get();
    if (!snap.exists) return res.json({ premium: false, plan: "free" });
    const data = snap.data();
    res.json({ premium: data.premium || false, plan: data.plan || "free", status: data.subscriptionStatus || "inactive" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
