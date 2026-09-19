/**
 * Capture real answers from Jev into the cassette, replacing the synthetic ones.
 *
 *   TYPESAFE_API_KEY=... npm run record
 *
 * After this, `npm run triage` and `npm run calibrate` run offline against real
 * model output, and the calibration numbers mean something.
 */
import { writeFileSync } from "node:fs";
import { CASSETTE_PATH, ask, openSession, stateFor } from "../core/client.js";
import { questionsFingerprint, stateKey, type Cassette, type CassetteEntry } from "../core/cassette.js";
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
