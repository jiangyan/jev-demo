/**
 * Does the confidence number mean anything?
 *
 *   npm run calibrate            # against whatever cassette is present
 *   npm run calibrate -- --live  # against the real API, with a key
 *
 * Everything the gate does rests on confidence being calibrated. This checks it
 * against the human labels in `tickets.ts` rather than taking it on faith.
 */
import { ask, openSession } from "../core/client.js";
import { operatingPoints, reliability, type Outcome } from "../core/calibration.js";
import { tickets } from "../core/tickets.js";
import { bar, bold, cyan, dim, green, pad, prob, red, rule, yellow } from "./ui.js";

const argv = process.argv.slice(2);
const session = openSession(
  argv.includes("--live") ? { mode: "live" } : argv.includes("--replay") ? { mode: "replay" } : {},
);

const outcomes: Outcome[] = [];
const misses: string[] = [];

for (const ticket of tickets) {
  const { answers } = await ask(session, ticket);
  const correct = answers.department.choice === ticket.label.department;
  outcomes.push({ confidence: answers.department.confidence, correct });
  if (!correct) {
    misses.push(
      `  ${dim(ticket.id)} said ${red(answers.department.choice)} at ${prob(answers.department.confidence)}, ` +
        `label says ${green(ticket.label.department)}${ticket.ambiguous ? dim(" (marked arguable)") : ""}`,
    );
  }
}

const report = reliability(outcomes);

console.log();
console.log(bold("  Calibration of the department answer"));
if (session.cassette?.generator === "synthetic") {
  console.log();
  console.log(yellow("  These are synthetic fixtures, not real Jev answers."));
  console.log(
    dim(
      "  The numbers below describe a local generator that was deliberately built\n" +
        "  overconfident. They say nothing about the real model. What they do show is\n" +
        "  that this harness detects miscalibration when it is there. Run `npm run record`\n" +
        "  with a real key, then run this again, to learn something about Jev.",
    ),
  );
}
console.log();

console.log(`  ${dim("decisions")}        ${report.n}`);
console.log(`  ${dim("accuracy")}         ${prob(report.accuracy)}`);
console.log(
  `  ${dim("mean confidence")}  ${prob(report.meanConfidence)}  ` +
    verdict(report.meanConfidence - report.accuracy),
);
console.log(`  ${dim("ECE")}              ${prob(report.ece)}  ${dim("mean gap between claimed and actual, 0 is perfect")}`);
console.log(`  ${dim("Brier")}            ${prob(report.brier)}  ${dim("lower is better; rewards being unsure when wrong")}`);
console.log();

console.log(bold("  Reliability"));
console.log(dim("  Of the answers claimed at X, how many were right?"));
console.log();
console.log(dim(`  ${pad("claimed", 10)}${pad("actual", 10)}${pad("n", 5)}`));
for (const bin of report.bins) {
  if (bin.count === 0) continue;
  const gap = bin.meanConfidence - bin.accuracy;
  const colour = Math.abs(gap) < 0.05 ? green : Math.abs(gap) < 0.15 ? yellow : red;
  console.log(
    `  ${pad(prob(bin.meanConfidence), 10)}${pad(colour(prob(bin.accuracy)), 10)}${pad(String(bin.count), 5)}` +
      bar(bin.accuracy, colour, 14) +
      dim(` ${gap > 0 ? "over" : "under"} by ${prob(Math.abs(gap))}`),
  );
}
console.log();

console.log(bold("  Where to put the gate"));
console.log(dim("  Automate everything at or above the threshold. Coverage is how much of the"));
console.log(dim("  queue that covers; escapes are the wrong ones that reach a customer."));
console.log();
console.log(dim(`  ${pad("threshold", 12)}${pad("coverage", 11)}${pad("precision", 12)}escapes`));
for (const point of operatingPoints(outcomes)) {
  console.log(
    `  ${pad(prob(point.threshold), 12)}${pad(prob(point.coverage), 11)}${pad(prob(point.precision), 12)}` +
      (point.escapes === 0 ? green("0") : red(String(point.escapes))),
  );
}
console.log();

if (misses.length > 0) {
  console.log(bold(`  Misses (${misses.length}/${report.n})`));
  for (const miss of misses) console.log(miss);
  console.log();
}

console.log(rule());
console.log(
  dim(
    `  ${tickets.filter((t) => t.ambiguous).length} of ${tickets.length} tickets are marked arguable by a human lead. ` +
      `A calibrated model\n  should be visibly less sure on those, and the gate should hand them over.`,
  ),
);
console.log();

function verdict(gap: number): string {
  if (gap > 0.05) return red(`overconfident by ${prob(gap)}`);
  if (gap < -0.05) return cyan(`underconfident by ${prob(-gap)}`);
  return green("well matched");
}
