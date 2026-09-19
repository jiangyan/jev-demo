import type { Answers } from "./gate.js";

export type Department = Answers["department"]["choice"];

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  /**
   * What a human support lead said the answer was. Present so the demo can score
   * itself; a real queue would not have this at the moment of the decision.
   */
  label: {
    department: Department;
    /** 0-3, matching the severity rubric in `questions.ts`. */
    severity: number;
    refund_requested: boolean;
    contains_pii: boolean;
    security_incident: boolean;
  };
  /**
   * Marked on tickets a human lead found genuinely arguable. These are where a
   * calibrated model should report low confidence, and where the gate should
   * hand over rather than guess.
   */
  ambiguous?: boolean;
}

/**
 * A small labelled queue. Deliberately not all easy: roughly a fifth of these sit
 * on a boundary between two teams, because a demo where every answer is obvious
 * tells you nothing about whether confidence means anything.
 */
export const tickets: Ticket[] = [
  {
    id: "T-1001",
    subject: "Charged twice for order A-104",
    body: "I was charged twice for order A-104 this morning. Two identical charges of $49. Please refund one of them.",
    label: { department: "billing", severity: 1, refund_requested: true, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1002",
    subject: "Webhooks stopped firing",
    body: "Since about 06:00 UTC our webhook endpoint receives nothing. No 4xx, no 5xx, just silence. Our order pipeline is stalled and we are not shipping anything.",
    label: { department: "technical", severity: 3, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1003",
    subject: "Someone else is logged into my account",
    body: "There is a session from an IP in another country that isn't me, and two API keys I did not create. Please lock the account now.",
    label: { department: "abuse", severity: 3, refund_requested: false, contains_pii: false, security_incident: true },
  },
  {
    id: "T-1004",
    subject: "How do I add a teammate?",
    body: "Hi, where in the dashboard do I invite a colleague to our workspace? Not urgent, just can't find it.",
    label: { department: "account", severity: 0, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1005",
    subject: "Payment page won't load",
    body: "The billing page spins forever in Chrome and Safari. I want to pay you but the page is broken. Console shows a 500 from /api/billing/summary.",
    label: { department: "technical", severity: 2, refund_requested: false, contains_pii: false, security_incident: false },
    ambiguous: true,
  },
  {
    id: "T-1006",
    subject: "Cancel my subscription",
    body: "Please cancel my plan at the end of the current period. I don't need a refund, just don't renew.",
    label: { department: "billing", severity: 0, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1007",
    subject: "THIRD TIME ASKING",
    body: "This is the third time I am writing. Nobody has replied. Your API has been returning 503 for two days and we are losing customers. Either fix this today or we are leaving and I want the quarter refunded.",
    label: { department: "technical", severity: 3, refund_requested: true, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1008",
    subject: "Lost my 2FA device",
    body: "My phone was stolen and I can't get past two-factor. I need to regain access to my account.",
    label: { department: "account", severity: 2, refund_requested: false, contains_pii: false, security_incident: false },
    ambiguous: true,
  },
  {
    id: "T-1009",
    subject: "Here are my card details",
    body: "You asked for the card on file. It is 4111 1111 1111 1111, exp 04/29, cvv 123. Please update the subscription to the annual plan.",
    label: { department: "billing", severity: 1, refund_requested: false, contains_pii: true, security_incident: false },
  },
  {
    id: "T-1010",
    subject: "Invoice VAT number wrong",
    body: "The VAT number on invoice INV-8831 is our old one. Can you reissue it with GB123456789?",
    label: { department: "billing", severity: 1, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1011",
    subject: "Our API key is in a public repo",
    body: "A contractor committed our production key to a public GitHub repo. It has been there since Friday. We have not rotated it yet. What do we do?",
    label: { department: "abuse", severity: 3, refund_requested: false, contains_pii: true, security_incident: true },
  },
  {
    id: "T-1012",
    subject: "Dashboard is slow",
    body: "The dashboard takes about 15 seconds to load the reports tab. It works eventually. Mildly annoying, not blocking.",
    label: { department: "technical", severity: 1, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1013",
    subject: "Refund for the extra seats",
    body: "We were billed for 20 seats but only ever activated 12. We would like the difference back for the last two months.",
    label: { department: "billing", severity: 1, refund_requested: true, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1014",
    subject: "Phishing email pretending to be you",
    body: "We received an email claiming to be from your billing team asking us to re-enter card details on a lookalike domain. Two of our staff clicked it.",
    label: { department: "abuse", severity: 2, refund_requested: false, contains_pii: false, security_incident: true },
  },
  {
    id: "T-1015",
    subject: "Can't log in after the password reset",
    body: "I reset my password and now the new one is rejected. Tried three browsers. I am completely locked out and I have a client demo in an hour.",
    label: { department: "account", severity: 3, refund_requested: false, contains_pii: false, security_incident: false },
    ambiguous: true,
  },
  {
    id: "T-1016",
    subject: "Do you have a student discount?",
    body: "Just wondering whether you offer any discount for students or non-profits before I sign up.",
    label: { department: "billing", severity: 0, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1017",
    subject: "Rate limited on the free plan",
    body: "We keep hitting 429s. Is this a bug or are we over a quota? If it is a quota we will upgrade, we just can't tell which it is from the error.",
    label: { department: "technical", severity: 2, refund_requested: false, contains_pii: false, security_incident: false },
    ambiguous: true,
  },
  {
    id: "T-1018",
    subject: "Remove my data",
    body: "I would like my account deleted and all personal data removed under GDPR. My account email is j.okafor@example.com and my home address is on file.",
    label: { department: "account", severity: 1, refund_requested: false, contains_pii: true, security_incident: false },
    ambiguous: true,
  },
  {
    id: "T-1019",
    subject: "Data export produces empty files",
    body: "Every CSV export downloads as a 0-byte file. This has been happening all week. We need this for month-end close on Friday.",
    label: { department: "technical", severity: 2, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1020",
    subject: "Unrecognised charge",
    body: "There is a charge from you on our statement for $890 that nobody here recognises and no invoice matches. Either someone has our card or your billing is wrong. Please investigate urgently.",
    label: { department: "billing", severity: 2, refund_requested: false, contains_pii: false, security_incident: false },
    ambiguous: true,
  },
  {
    id: "T-1021",
    subject: "Thanks",
    body: "Just wanted to say the new export feature is great. No action needed.",
    label: { department: "other", severity: 0, refund_requested: false, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1022",
    subject: "SSO group mapping not applied",
    body: "Users provisioned through Okta land with no group, so they see nothing after login. We have 40 new staff blocked on this.",
    label: { department: "technical", severity: 3, refund_requested: false, contains_pii: false, security_incident: false },
    ambiguous: true,
  },
  {
    id: "T-1023",
    subject: "Downgrade did not take effect",
    body: "I downgraded to the starter plan last month and was billed at the pro rate again. Please fix the plan and credit the difference.",
    label: { department: "billing", severity: 1, refund_requested: true, contains_pii: false, security_incident: false },
  },
  {
    id: "T-1024",
    subject: "Is this email from you?",
    body: "Got a message saying our account will be suspended unless we confirm payment details at this link. Looks off. Can you confirm whether it is genuine?",
    label: { department: "abuse", severity: 1, refund_requested: false, contains_pii: false, security_incident: true },
    ambiguous: true,
  },
];
