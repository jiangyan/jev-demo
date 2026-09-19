import { choice, noul, score } from "@typesafe-ai/sdk";

/**
 * The decision sheet.
 *
 * Every question below is answered in a *single* call to Jev. The model evaluates
 * them in parallel, so asking six questions costs roughly what asking one costs --
 * which is why the natural unit of work here is a whole sheet, not a classifier.
 *
 * Criteria describe *situations*, not degrees. "Broken, but a workaround exists"
 * gives the model something to match the ticket against; "moderately severe" does not.
 */
export const decisionSheet = {
  department: choice("Which team should own this ticket?", {
    billing: {
      what: "Charges, invoices, refunds, subscriptions, payment methods, pricing.",
      not_for: "A payment feature that is technically broken -- that is `technical`.",
      examples: ["charged twice", "cancel my plan", "invoice is wrong"],
    },
    technical: {
      what: "The product is broken, erroring, slow, or behaving incorrectly.",
      not_for: "Questions about what the product costs.",
      examples: ["API returns 500", "webhook never fires", "dashboard won't load"],
    },
    account: {
      what: "Login, passwords, 2FA, seats, permissions, organisation membership.",
      not_for: "Suspected compromise of an account -- that is `abuse`.",
      examples: ["can't log in", "add a teammate", "lost my 2FA device"],
    },
    abuse: {
      what: "Security incidents, compromised accounts, fraud, spam, policy violations.",
      examples: ["someone else is in my account", "leaked API key", "phishing email"],
    },
    other: "Anything that does not clearly belong to the teams above.",
  }),

  severity: score("How badly is the customer blocked right now?", [
    "A question or request with nothing broken. Nobody is blocked.",
    "Something is degraded or awkward, but a workaround exists.",
    "A core workflow is broken for this customer with no workaround.",
    "Money is being lost, data is at risk, or the customer is entirely down.",
  ]),

  frustration: score("How does the customer sound?", [
    "Neutral or friendly. Straightforward request.",
    "Impatient. Mentions waiting, repeating themselves, or a previous attempt.",
    "Angry. Threatens to leave, demands escalation, or uses hostile language.",
  ]),

  refund_requested: noul("Does the customer explicitly ask for money back?", {
    true: "Asks for a refund, a credit, a chargeback, or to be made whole financially.",
    false: "Mentions a charge or a price without asking for money back.",
  }),

  contains_pii: noul("Does the message contain personal or secret data?", {
    true: "Card numbers, government IDs, passwords, API keys, or private addresses.",
    false: "Order numbers, account emails, and product identifiers only.",
  }),

  security_incident: noul("Is this a live security incident?", {
    true: "Unauthorised access, a leaked credential, or suspected fraud in progress.",
    false: "A routine account or access request with no sign of compromise.",
  }),
} as const;

export type DecisionSheet = typeof decisionSheet;
