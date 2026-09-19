import type { Answers } from "../src/core/gate.js";

/** A neutral sheet of answers. Override only what a test is about. */
export function answers(overrides: Partial<{
  department: string;
  confidence: number;
  severity: number;
  frustration: number;
  refund: number;
  pii: number;
  security: number;
}> = {}): Answers {
  const {
    department = "billing",
    confidence = 0.95,
    severity = 1,
    frustration = 0,
    refund = 0.02,
    pii = 0.02,
    security = 0.02,
  } = overrides;

  return {
    department: {
      type: "choice",
      choice: department,
      confidence,
      probabilities: { billing: 0, technical: 0, account: 0, abuse: 0, other: 0, [department]: confidence },
    },
    severity: { type: "score", score: severity, confidence: 0.8, legend: {}, probabilities: {} },
    frustration: { type: "score", score: frustration, confidence: 0.8, legend: {}, probabilities: {} },
    refund_requested: { type: "noul", noul: refund },
    contains_pii: { type: "noul", noul: pii },
    security_incident: { type: "noul", noul: security },
  } as unknown as Answers;
}
