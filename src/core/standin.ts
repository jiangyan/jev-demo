/**
 * A STAND-IN, NOT A MODEL.
 *
 * This file exists so the compose demo does something when there is no API key and no
 * recording. It is a handful of keyword rules, and it is deliberately dumb: you can read
 * every rule it has in the next sixty lines. It does not approximate Jev, and it is not
 * pretending to. What it lets you see is the *shape* of the thing -- typed judgements
 * arriving fast enough to drive an interface while you type -- with an obviously fake
 * source of judgement behind it.
 *
 * With `TYPESAFE_API_KEY` set the demo calls the real model instead. Running
 * `npm run record` captures real answers for the sample drafts, after which the offline
 * demo replays those and this file is never reached for them.
 *
 * The one thing it is honest about by construction: it returns exactly the same shape as
 * the API, so nothing downstream can tell the difference or has to care.
 */

import type { ComposeAnswers, ComposeState } from "./compose.js";
import { composeSheet, words } from "./compose.js";

const SHARP = [
  "actually", "as i said", "as i already", "again", "obviously", "clearly",
  "you should have", "if you had", "you failed", "your mistake", "not our problem",
  "nothing for us", "there is nothing", "frankly", "for the last time",
];
const BLAME = [
  "you should have", "if you had", "you failed", "your mistake", "you did not",
  "you didn't", "you misread", "you never", "your error", "you forgot",
];
const WARM = ["sorry", "apolog", "thanks", "thank you", "understood", "happy to", "of course"];
const SECRET =
  /((?:secret|token|key|password)\s*[:=]?\s+[a-z0-9._-]{20,}|sk-[a-z0-9]{12,}|apikey_[a-f0-9]{8,}|bearer\s+[a-z0-9._-]{16,}|\b(?:\d[ -]?){13,16}\b)/i;
const PROMISE = [
  "will have this", "will be ready", "guarantee", "by friday", "by monday", "by the end of",
  "refund this month", "i will refund", "fully fixed", "restored by", "before month end",
];
const ANSWERED = [
  "yes", "no,", "no.", "it will not", "it will be", "we can", "we cannot", "we can't",
  "there is nothing", "should have dropped", "here is what", "we will have this",
  "i have raised", "point the endpoint", "by friday", "use the shared",
];

function hits(haystack: string, needles: string[]): number {
  return needles.reduce((n, needle) => n + (haystack.includes(needle) ? 1 : 0), 0);
}

/** Squash a count into a 0-1 probability that never quite reaches certainty. */
function soften(count: number, per = 0.34): number {
  return Math.min(0.94, count * per);
}

function distributeScore(target: number, levels: number): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (let i = 0; i < levels; i++) {
    const w = 1 / (1 + Math.pow(i - target, 2) * 2.2);
    out[String(i)] = w;
    total += w;
  }
  for (const k of Object.keys(out)) out[k] = Math.round((out[k]! / total) * 1000) / 1000;
  return out;
}

function expectation(probabilities: Record<string, number>): number {
  return Object.entries(probabilities).reduce((sum, [k, p]) => sum + Number(k) * p, 0);
}

function confidenceOf(probabilities: Record<string, number>): number {
  return Math.max(...Object.values(probabilities));
}

/** Answers in the API's own shape, from rules you can read above. */
export function standIn(state: ComposeState): ComposeAnswers {
  const draft = state.my_reply.toLowerCase();
  const n = words(state.my_reply);

  const sharpness = hits(draft, SHARP);
  const warmth = hits(draft, WARM);
  const blame = hits(draft, BLAME);

  // 0 warm, 1 neutral, 2 clipped, 3 hostile. An empty draft sits at neutral.
  let tone = 1;
  if (n === 0) tone = 1;
  else {
    tone = 1 + sharpness * 0.75 + blame * 0.7 - Math.min(warmth, 2) * 0.55;
    tone = Math.max(0, Math.min(3, tone));
  }

  const toneProbs = distributeScore(tone, composeSheet.tone.criteria.length);

  const answered = n === 0 ? 0.08 : Math.min(0.93, 0.12 + soften(hits(draft, ANSWERED), 0.3) + (n > 45 ? 0.08 : 0));

  return {
    tone: {
      type: "score",
      score: Math.round(expectation(toneProbs) * 1000) / 1000,
      confidence: confidenceOf(toneProbs),
      legend: Object.fromEntries(composeSheet.tone.criteria.map((c, i) => [String(i), c])),
      probabilities: toneProbs,
    },
    answers_them: { type: "noul", noul: round(answered) },
    contains_secret: { type: "noul", noul: SECRET.test(state.my_reply) ? 0.96 : n === 0 ? 0.02 : 0.04 },
    makes_promise: { type: "noul", noul: round(n === 0 ? 0.03 : soften(hits(draft, PROMISE), 0.38)) },
    blames_reader: { type: "noul", noul: round(n === 0 ? 0.03 : soften(blame, 0.55)) },
  } as unknown as ComposeAnswers;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
