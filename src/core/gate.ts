import type { SystemOneResult } from "@typesafe-ai/sdk";
import type { DecisionSheet } from "./questions.js";

export type Answers = SystemOneResult<DecisionSheet>["answers"];

/** What the software does with a decision sheet. */
export type Disposition =
  /** Confident enough to act on without a person looking. */
  | "auto"
  /** Acted on, but a person is asked to confirm first. */
  | "confirm"
  /** Handed to a person. The model's answer is a hint, not a decision. */
  | "human";

export type Priority = "P0" | "P1" | "P2" | "P3";

/**
 * Thresholds are scaled to consequence, not set once globally.
 *
 * Routing a ticket to the wrong queue costs someone a few minutes, so it can run
 * on a fairly ordinary confidence. Closing a security incident unseen could cost a
 * great deal more, so it is never automated at all. That asymmetry is the whole
 * point of getting a calibrated probability back instead of a bare label.
 */
export interface Thresholds {
  /** Route to a team unattended at or above this confidence. */
  autoRoute: number;
  /** Route but ask a person to confirm at or above this confidence. Below it, hand over entirely. */
  confirmRoute: number;
  /** Treat `security_incident` as true at or above this probability. Deliberately low: a false alarm is cheap, a miss is not. */
  securitySuspicion: number;
  /** Treat `contains_pii` as true at or above this probability. Also deliberately low. */
  pii: number;
  /** Treat `refund_requested` as true at or above this probability. */
  refund: number;
}

export const defaultThresholds: Thresholds = {
  autoRoute: 0.85,
  confirmRoute: 0.6,
  securitySuspicion: 0.25,
  pii: 0.3,
  refund: 0.5,
};

export interface Routing {
  disposition: Disposition;
  /** The team the sheet points at, whoever ends up acting on it. */
  department: Answers["department"]["choice"];
  priority: Priority;
  /** Confidence in the department label, carried through so the UI can show its working. */
  confidence: number;
  /** Side effects the pipeline should perform, in order. */
  actions: string[];
  /** Why this disposition, in the order the rules fired. */
  reasons: string[];
}

/** Severity 0-3 maps onto the on-call priorities the team already uses. */
function priorityFor(severity: number): Priority {
  if (severity >= 2.5) return "P0";
  if (severity >= 1.5) return "P1";
  if (severity >= 0.5) return "P2";
  return "P3";
}

/**
 * Turn a sheet of answers into a decision.
 *
 * Note what this function does *not* do: it never inspects the ticket text. Jev has
 * already reduced the text to typed values, so the business rules are plain
 * arithmetic over numbers and enums, and every branch here is unit-testable
 * without a model in the loop.
 */
export function route(answers: Answers, thresholds: Thresholds = defaultThresholds): Routing {
  const reasons: string[] = [];
  const actions: string[] = [];

  const department = answers.department.choice;
  const confidence = answers.department.confidence;
  const severity = answers.severity.score;
  const frustration = answers.frustration.score;

  let priority = priorityFor(severity);
  let disposition: Disposition =
    confidence >= thresholds.autoRoute
      ? "auto"
      : confidence >= thresholds.confirmRoute
        ? "confirm"
        : "human";

  reasons.push(
    disposition === "auto"
      ? `Department confidence ${fmt(confidence)} clears the ${fmt(thresholds.autoRoute)} bar for unattended routing.`
      : disposition === "confirm"
        ? `Department confidence ${fmt(confidence)} is usable but under ${fmt(thresholds.autoRoute)}, so a person confirms.`
        : `Department confidence ${fmt(confidence)} is under ${fmt(thresholds.confirmRoute)}. The model is not sure enough to be useful here.`,
  );
  actions.push(`route:${department}`);

  // Personal data is redacted before a ticket is stored or forwarded, whatever
  // else happens to it. This runs on suspicion, not on certainty.
  if (answers.contains_pii.noul >= thresholds.pii) {
    actions.unshift("redact:pii");
    reasons.push(`Possible personal data (p=${fmt(answers.contains_pii.noul)}); redacting before storage.`);
  }

  if (answers.refund_requested.noul >= thresholds.refund) {
    actions.push("flag:refund-requested");
    reasons.push(`Refund asked for (p=${fmt(answers.refund_requested.noul)}); billing will need to approve.`);
  }

  // An angry customer does not change who should handle the ticket, only how fast.
  if (frustration >= 1.5 && priority !== "P0") {
    priority = priority === "P1" ? "P0" : "P1";
    reasons.push(`Customer sounds angry (${fmt(frustration)}/2); raising priority to ${priority}.`);
  }

  // Consequence overrides confidence. A suspected incident is never closed
  // unattended, however sure the model is about anything on the sheet.
  if (answers.security_incident.noul >= thresholds.securitySuspicion) {
    disposition = "human";
    priority = "P0";
    actions.unshift("page:security");
    reasons.push(
      `Possible security incident (p=${fmt(answers.security_incident.noul)}). This class of ticket is never automated, at any confidence.`,
    );
  }

  return { disposition, department, priority, confidence, actions, reasons };
}

function fmt(n: number): string {
  return n.toFixed(2);
}
