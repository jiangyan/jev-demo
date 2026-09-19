/**
 * The demo: a queue of support tickets, one Jev call each, and an automation gate.
 *
 *   npm run triage              # replay mode unless TYPESAFE_API_KEY is set
 *   npm run triage -- --live    # call the real API
 *   npm run triage -- --explain # show why each decision went the way it did
 */
import { ask, openSession } from "../core/client.js";
import { defaultThresholds, route, type Disposition } from "../core/gate.js";
import { tickets } from "../core/tickets.js";
import { bar, blue, bold, cyan, dim, green, magenta, pad, prob, red, rule, yellow } from "./ui.js";

const argv = process.argv.slice(2);
const explain = argv.includes("--explain");
const limitArg = argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : tickets.length;

const session = openSession(
  argv.includes("--live") ? { mode: "live" } : argv.includes("--replay") ? { mode: "replay" } : {},
);

const dispositionStyle: Record<Disposition, (t: string) => string> = {
  auto: green,
  confirm: yellow,
  human: red,
};

console.log();
console.log(bold("  Jev triage desk"));
console.log(
  dim(
    `  gate: auto at \u2265${defaultThresholds.autoRoute}, confirm at \u2265${defaultThresholds.confirmRoute}, ` +
      `hand over below. Security suspicion is never automated.`,
  ),
);
if (session.mode === "replay") {
  const synthetic = session.cassette?.generator === "synthetic";
  console.log(
    dim("  replay mode: ") +
      (synthetic
        ? yellow("synthetic fixtures. Nothing here reflects the real model.")
        : dim("recorded fixtures. No network calls.")),
  );
  if (session.staleCassette) {
    console.log(red("  The cassette was recorded for a different question set. Re-record it."));
  }
} else {
  console.log(dim(`  live mode: calling ${session.client.baseURL} as ${session.client.defaultModel}`));
}
console.log();

const counts: Record<Disposition, number> = { auto: 0, confirm: 0, human: 0 };
let inputTokens = 0;
let outputTokens = 0;
const latencies: number[] = [];

for (const ticket of tickets.slice(0, limit)) {
  const decision = await ask(session, ticket);
  const { answers } = decision;
  const routing = route(answers);

  counts[routing.disposition] += 1;
  inputTokens += decision.usage.input_tokens;
  outputTokens += decision.usage.output_tokens;
  latencies.push(decision.ms);

  const style = dispositionStyle[routing.disposition];
  console.log(
    `  ${dim(ticket.id)}  ${bold(ticket.subject)}`,
  );
  console.log(
    `  ${bar(routing.confidence, style)} ` +
      `${pad(cyan(routing.department), 12)} ${pad(prob(routing.confidence), 5)} ` +
      `${pad(style(routing.disposition.toUpperCase()), 9)} ${magenta(routing.priority)}`,
  );
  console.log(
    dim(
      `  severity ${answers.severity.score.toFixed(1)}/3 · ` +
        `tone ${answers.frustration.score.toFixed(1)}/2 · ` +
        `refund ${answers.refund_requested.noul.toFixed(2)} · ` +
        `pii ${answers.contains_pii.noul.toFixed(2)} · ` +
        `security ${answers.security_incident.noul.toFixed(2)}`,
    ),
  );
  console.log(`  ${dim("→")} ${routing.actions.map(blue).join(dim(", "))}`);
  if (explain) {
    for (const reason of routing.reasons) console.log(dim(`    · ${reason}`));
  }
  console.log();
}

const n = latencies.length;
// $0.042 per million input tokens; output tokens are free.
const cost = (inputTokens / 1_000_000) * 0.042;

console.log(rule());
console.log(
  `  ${green(`${counts.auto} automated`)}  ${yellow(`${counts.confirm} confirm`)}  ${red(`${counts.human} to a human`)}` +
    dim(`   (${n} tickets, ${((counts.auto / n) * 100).toFixed(0)}% handled unattended)`),
);
console.log(
  dim(
    `  ${inputTokens} input tokens, ${outputTokens} output · ` +
      `$${cost.toFixed(6)} for the batch · $${((cost / n) * 1000).toFixed(4)} per 1000 tickets`,
  ),
);
console.log(
  session.mode === "live"
    ? dim(`  median ${median(latencies).toFixed(0)}ms per ticket, six questions each`)
    : dim("  latency not shown: replay does no I/O, so the numbers would be meaningless"),
);
console.log();

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
