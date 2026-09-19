/**
 * A stand-in for api.typesafe.ai on localhost.
 *
 * Point the demo at it to exercise the *live* code path without a key and without
 * touching the network: the real SDK, a real HTTP request to /v1/systemone, a real
 * Authorization header, a real JSON response parsed by the real client. Only the far
 * end is fake, and it logs what it was sent so you can see the shape of a request.
 *
 *   node tools/fake-api.mjs &
 *   TYPESAFE_API_KEY=anything TYPESAFE_BASE_URL=http://localhost:8899 npm run web -- --live
 *
 * It answers every question with the same flat numbers, so it tells you the wiring
 * works and nothing else. For real answers you need a real key and `npm run web -- --live`.
 */
import { createServer } from "node:http";
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  const auth = req.headers.authorization || "";
  console.error(`[fake-api] ${req.method} ${req.url} auth=${auth.slice(0, 14)}... questions=${Object.keys(body.questions || {}).join(",")}`);
  const answers = {};
  for (const [name, q] of Object.entries(body.questions || {})) {
    if (q.type === "noul") answers[name] = { type: "noul", noul: 0.42 };
    else if (q.type === "choice") {
      const labels = Object.keys(q.criteria);
      const probabilities = Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.7 : 0.3 / (labels.length - 1)]));
      answers[name] = { type: "choice", choice: labels[0], confidence: 0.7, probabilities };
    } else {
      const n = q.criteria.length;
      const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 1 ? 0.6 : 0.4 / (n - 1)]));
      answers[name] = { type: "score", score: 1.1, confidence: 0.6, legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])), probabilities };
    }
  }
  res.writeHead(200, { "content-type": "application/json", "x-typesafe-request-id": "fake-1" });
  res.end(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 312, output_tokens: 48 } }));
}).listen(8899, () => console.error("[fake-api] listening on 8899"));
