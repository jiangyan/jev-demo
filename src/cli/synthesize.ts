/**
 * Regenerate the synthetic cassette.
 *
 * Only useful while there is no way to reach the real API from here. Prefer
 * `npm run record`, which captures real answers and overwrites this file.
 */
import { writeFileSync } from "node:fs";
import { CASSETTE_PATH, stateFor } from "../core/client.js";
import { questionsFingerprint, stateKey, type Cassette, type CassetteEntry } from "../core/cassette.js";
import { decisionSheet } from "../core/questions.js";
import { syntheticResponse } from "../core/synthetic.js";
import { tickets } from "../core/tickets.js";

const entries: Record<string, CassetteEntry> = {};
for (const ticket of tickets) {
  entries[stateKey(stateFor(ticket))] = {
    label: `${ticket.id} ${ticket.subject}`,
    response: syntheticResponse(ticket),
  };
}

const cassette: Cassette = {
  generator: "synthetic",
  createdAt: new Date().toISOString(),
  model: "jev-latest",
  questionsFingerprint: questionsFingerprint(decisionSheet),
  note:
    "GENERATED LOCALLY, NOT RECORDED FROM JEV. Shaped like a real response so the demo " +
    "runs offline. Says nothing about the real model's accuracy or calibration. " +
    "Run `npm run record` with a real API key to replace it.",
  entries,
};

writeFileSync(CASSETTE_PATH, `${JSON.stringify(cassette, null, 2)}\n`);
console.log(`Wrote ${Object.keys(entries).length} synthetic entries to ${CASSETTE_PATH}`);
