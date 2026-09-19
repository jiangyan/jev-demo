/**
 * Capture real answers from Jev into the cassette, replacing the synthetic ones.
 *
 *   TYPESAFE_API_KEY=... npm run record
 *
 * After this, `npm run triage` and `npm run calibrate` run offline against real
 * model output, and the calibration numbers mean something.
 */
import { writeFileSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { CASSETTE_PATH, ask, openSession, stateFor } from "../core/client.js";
import { questionsFingerprint, stateKey, type Cassette, type CassetteEntry } from "../core/cassette.js";
import { composeSheet, prefixes, type ComposeState } from "../core/compose.js";
import { COMPOSE_CASSETTE } from "../core/composeSource.js";
import { drafts } from "../core/drafts.js";
import { decisionSheet } from "../core/questions.js";
import { tickets } from "../core/tickets.js";
import { bold, dim, green, red } from "./ui.js";

const session = openSession({ mode: "live" });

console.log();
console.log(bold(`  Recording ${tickets.length} tickets against ${session.client.defaultModel}`));
console.log(dim(`  ${session.client.baseURL}`));
console.log();

const entries: Record<string, CassetteEntry> = {};
const latencies: number[] = [];
let model = session.client.defaultModel;
let failures = 0;

for (const ticket of tickets) {
  try {
    const decision = await ask(session, ticket);
    model = decision.model;
    latencies.push(decision.ms);
    entries[stateKey(stateFor(ticket))] = {
      label: `${ticket.id} ${ticket.subject}`,
      response: { model: decision.model, answers: decision.answers, usage: decision.usage },
    };
    console.log(
      `  ${green("ok")}   ${dim(ticket.id)} ${ticket.subject} ` +
        dim(`(${decision.ms.toFixed(0)}ms, ${decision.answers.department.choice})`),
    );
  } catch (error) {
    failures += 1;
    console.log(`  ${red("fail")} ${dim(ticket.id)} ${ticket.subject}`);
    console.log(`       ${red(error instanceof Error ? error.message : String(error))}`);
  }
}

if (Object.keys(entries).length === 0) {
  console.error(red("\n  Nothing recorded. The cassette was left alone.\n"));
  process.exit(1);
}

const cassette: Cassette = {
  generator: "recorded",
  createdAt: new Date().toISOString(),
  model,
  questionsFingerprint: questionsFingerprint(decisionSheet),
  note: `Recorded from ${session.client.baseURL} against ${model}.`,
  entries,
};

writeFileSync(CASSETTE_PATH, `${JSON.stringify(cassette, null, 2)}\n`);

const sorted = [...latencies].sort((a, b) => a - b);
const median = sorted.length > 0 ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;

console.log();
console.log(
  `  Wrote ${Object.keys(entries).length} entries to ${CASSETTE_PATH}` +
    (failures > 0 ? red(`  (${failures} failed)`) : ""),
);
console.log(dim(`  median ${median.toFixed(0)}ms per ticket, ${Object.keys(decisionSheet).length} questions each`));
console.log();

/* ---------------------------------------------------------------------------
 * The compose demo needs an answer for every prefix of every sample reply, since
 * it re-asks on each word typed. A few dozen calls per draft, which at $0.042 per
 * million input tokens is not worth counting.
 * ------------------------------------------------------------------------- */

const composeClient = new TypeSafeClient();
const composeEntries: Record<string, CassetteEntry> = {};
let composeModel = composeClient.defaultModel;
let composeFailures = 0;
let composeCalls = 0;

console.log(bold(`  Recording ${drafts.length} drafts, one call per word`));
console.log();

for (const draft of drafts) {
  const steps = prefixes(draft.reply);
  process.stdout.write(`  ${dim(draft.id)} ${draft.title} `);

  for (const [index, prefix] of steps.entries()) {
    const state: ComposeState = { they_wrote: draft.theyWrote, my_reply: prefix };
    try {
      const result = await composeClient.systemOne({
        state: state as unknown as Record<string, string>,
        questions: composeSheet,
      });
      composeModel = result.model;
      composeCalls += 1;
      composeEntries[stateKey(state as unknown as Record<string, string>)] = {
        label: `${draft.id} @ ${index} words`,
        response: { model: result.model, answers: result.answers, usage: result.usage },
      };
      process.stdout.write(green("."));
    } catch (error) {
      composeFailures += 1;
      process.stdout.write(red("x"));
      if (composeFailures === 1) {
        console.log();
        console.log(`    ${red(error instanceof Error ? error.message : String(error))}`);
      }
    }
  }
  console.log();
}

if (composeCalls > 0) {
  const composeCassette: Cassette = {
    generator: "recorded",
    createdAt: new Date().toISOString(),
    model: composeModel,
    questionsFingerprint: questionsFingerprint(composeSheet),
    note: `Recorded from ${composeClient.baseURL} against ${composeModel}, one entry per word of each sample reply.`,
    entries: composeEntries,
  };
  writeFileSync(COMPOSE_CASSETTE, `${JSON.stringify(composeCassette, null, 2)}\n`);
  console.log();
  console.log(
    `  Wrote ${composeCalls} compose entries to ${COMPOSE_CASSETTE}` +
      (composeFailures > 0 ? red(`  (${composeFailures} failed)`) : ""),
  );
} else {
  console.log(red("  Nothing recorded for compose."));
}
console.log();
