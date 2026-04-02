import { setCors } from "./_lib.js";

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.json({ status: "ok", ts: new Date().toISOString() });
}
