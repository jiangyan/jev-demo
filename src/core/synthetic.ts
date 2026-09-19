/**
 * SYNTHETIC FIXTURES -- NOT RECORDED FROM JEV.
 *
 * This environment cannot reach `api.typesafe.ai`, so the fixtures checked into
 * this repository were generated here rather than recorded from the real model.
 * They are shaped exactly like a real `POST /v1/systemone` response, which is
 * enough to exercise the gate, the CLI and the calibration harness offline, and
 * they tell you nothing whatsoever about how well Jev actually performs.
 *
 * Run `npm run record` with a real key to replace them with real answers. The
 * calibration numbers printed by the demo only mean something after you do.
 *
 * The generator deliberately injects a known miscalibration -- it reports higher
 * confidence than it deserves -- so that `npm run calibrate` has something real to
 * find. Detecting a fault we planted is a test of the harness. It is not evidence
 * about the model.
 */

import type { Ticket } from "./tickets.js";
import { decisionSheet } from "./questions.js";

/**
 * How overconfident the synthetic model is: the fraction of the remaining gap to
 * certainty that it claims. At 0.45, a decision it gets right 80% of the time is
 * reported at 0.89. Expressed this way rather than as a flat offset so that
 * confidences stay below 1 and keep a realistic spread.
 */
const OVERCONFIDENCE = 0.45;

const DEPARTMENTS = Object.keys(decisionSheet.department.criteria) as Array<
  keyof typeof decisionSheet.department.criteria
>;

/** Deterministic PRNG so the fixtures are reproducible across machines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Spread `1 - peak` over the other labels, weighted by a little noise. */
function distribute(
  labels: readonly string[],
  winner: string,
  peak: number,
  rand: () => number,
): Record<string, number> {
  const others = labels.filter((l) => l !== winner);
  const weights = others.map(() => 0.2 + rand());
  const total = weights.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = { [winner]: peak };
  others.forEach((label, i) => {
    out[label] = ((weights[i] ?? 1) / total) * (1 - peak);
  });
  return out;
}

function noulFor(truth: boolean, rand: () => number, certainty: number): number {
  const p = certainty + rand() * (1 - certainty) * 0.8;
  return round(truth ? p : 1 - p);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A response body shaped like the real API's, for one ticket. */
export function syntheticResponse(ticket: Ticket, model = "jev-latest"): unknown {
  const rand = mulberry32(seedFrom(ticket.id));

  // True chance this synthetic model picks the right department, varied per ticket
  // so confidences come out with a realistic spread. Boundary tickets are genuinely
  // harder, so it is wrong on them more often.
  const trueAccuracy = ticket.ambiguous ? 0.35 + rand() * 0.35 : 0.76 + rand() * 0.21;
  const isCorrect = rand() < trueAccuracy;

  const actual = ticket.label.department;
  const wrongOptions = DEPARTMENTS.filter((d) => d !== actual);
  const picked = isCorrect ? actual : (wrongOptions[Math.floor(rand() * wrongOptions.length)] ?? "other");

  // ...but it *reports* a confidence above its true hit rate. This is the planted fault.
  const reported = Math.min(0.995, trueAccuracy + (1 - trueAccuracy) * OVERCONFIDENCE);
  const departmentProbabilities = distribute(DEPARTMENTS, picked, reported, rand);

  const severityLevels = decisionSheet.severity.criteria.length;
  const severityPeak = 0.66 + rand() * 0.28;
  const severityProbabilities = distribute(
    Array.from({ length: severityLevels }, (_, i) => String(i)),
    String(ticket.label.severity),
    severityPeak,
    rand,
  );
  // A score answer is the expectation over the rubric levels, so it can land
  // between them -- which is why `score` comes back fractional.
  const severityScore = Object.entries(severityProbabilities).reduce(
    (sum, [level, p]) => sum + Number(level) * p,
    0,
  );

  const frustrationLevels = decisionSheet.frustration.criteria.length;
  const frustrationTruth = Math.min(
    frustrationLevels - 1,
    ticket.label.severity >= 3 ? 2 : ticket.label.severity >= 2 ? 1 : 0,
  );
  const frustrationPeak = 0.5 + rand() * 0.35;
  const frustrationProbabilities = distribute(
    Array.from({ length: frustrationLevels }, (_, i) => String(i)),
    String(frustrationTruth),
    frustrationPeak,
    rand,
  );
  const frustrationScore = Object.entries(frustrationProbabilities).reduce(
    (sum, [level, p]) => sum + Number(level) * p,
    0,
  );

  return {
    model,
    answers: {
      department: {
        type: "choice",
        choice: picked,
        confidence: round(reported),
        probabilities: mapValues(departmentProbabilities, round),
      },
      severity: {
        type: "score",
        score: round(severityScore),
        confidence: round(severityPeak),
        legend: Object.fromEntries(decisionSheet.severity.criteria.map((c, i) => [String(i), c])),
        probabilities: mapValues(severityProbabilities, round),
      },
      frustration: {
        type: "score",
        score: round(frustrationScore),
        confidence: round(frustrationPeak),
        legend: Object.fromEntries(decisionSheet.frustration.criteria.map((c, i) => [String(i), c])),
        probabilities: mapValues(frustrationProbabilities, round),
      },
      refund_requested: { type: "noul", noul: noulFor(ticket.label.refund_requested, rand, 0.72) },
      contains_pii: { type: "noul", noul: noulFor(ticket.label.contains_pii, rand, 0.78) },
      security_incident: { type: "noul", noul: noulFor(ticket.label.security_incident, rand, 0.7) },
    },
    usage: {
      input_tokens: 140 + Math.floor((ticket.subject.length + ticket.body.length) / 3),
      output_tokens: 48,
    },
  };
}

function mapValues<T, U>(obj: Record<string, T>, fn: (value: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}
