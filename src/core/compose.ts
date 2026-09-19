import { noul, score } from "@typesafe-ai/sdk";
import type { SystemOneResult } from "@typesafe-ai/sdk";

/**
 * The compose sheet: what gets asked about a half-written reply, on every keystroke.
 *
 * This is the shape of question a System One model makes practical. None of it needs
 * prose back, all of it needs to be true *now* rather than in three seconds, and there
 * are five of them, which costs about what one costs.
 */
export const composeSheet = {
  tone: score("How will this reply land with the person reading it?", [
    "Warm. Reads like someone who wants to help.",
    "Plain and businesslike. Nothing wrong with it.",
    "Clipped. Terse enough that the reader may feel brushed off.",
    "Hostile. Sarcastic, accusatory, or openly annoyed.",
  ]),

  answers_them: noul("Does the reply address what the person actually asked?", {
    true: "Responds to the question that was put, even if the answer is no.",
    false: "Talks about something adjacent, or only acknowledges the message.",
  }),

  contains_secret: noul("Is there a credential or private detail in the reply?", {
    true: "An API key, token, password, card number, or a home address.",
    false: "Order numbers, ticket references, and public identifiers only.",
  }),

  makes_promise: noul("Does the reply commit to something specific?", {
    true: "Names a date, promises a refund, or guarantees a particular outcome.",
    false: "Describes what is being looked into without committing to a result.",
  }),

  blames_reader: noul("Does the reply put the fault on the person reading it?", {
    true: "Says or implies they did it wrong, misread, or should have known.",
    false: "Takes responsibility, or describes the problem without assigning blame.",
  }),
} as const;

export type ComposeSheet = typeof composeSheet;
export type ComposeAnswers = SystemOneResult<ComposeSheet>["answers"];

/** The state Jev is given: the message being replied to, and the draft so far. */
export interface ComposeState {
  they_wrote: string;
  my_reply: string;
}

export type Severity = "stop" | "warn" | "ok";

export interface Flag {
  id: string;
  severity: Severity;
  /** What the writer sees. Written for the person, not about the model. */
  message: string;
}

export interface SendVerdict {
  /** Whether the Send button works. */
  blocked: boolean;
  flags: Flag[];
  /** One line under the button. */
  summary: string;
}

/**
 * Whether this is ready to send.
 *
 * Thresholds differ by what the mistake costs, the same way they do in `gate.ts`.
 * Sending a live API key to a stranger cannot be taken back, so that one blocks on
 * suspicion. A reply that reads a bit sharp is worth a word of warning and nothing more:
 * this sits between a person and their own sentence, and a tool that argues with every
 * draft gets switched off in a week.
 */
export function judge(answers: ComposeAnswers, draft: string): SendVerdict {
  const flags: Flag[] = [];

  if (answers.contains_secret.noul >= 0.4) {
    flags.push({
      id: "secret",
      severity: "stop",
      message: "There is a credential or card number in this. Take it out before sending.",
    });
  }

  if (answers.tone.score >= 2.4 || answers.blames_reader.noul >= 0.65) {
    flags.push({
      id: "tone",
      severity: "stop",
      message:
        answers.blames_reader.noul >= 0.65
          ? "This reads as blaming them. Worth another pass before it goes."
          : "This is going to land badly. Worth another pass before it goes.",
    });
  } else if (answers.tone.score >= 1.7) {
    flags.push({ id: "clipped", severity: "warn", message: "Reads a little clipped." });
  }

  // Only worth saying once there is enough of a reply to have missed the point.
  if (words(draft) >= 12 && answers.answers_them.noul <= 0.35) {
    flags.push({
      id: "unanswered",
      severity: "warn",
      message: "You have not answered what they actually asked yet.",
    });
  }

  if (answers.makes_promise.noul >= 0.6) {
    flags.push({
      id: "promise",
      severity: "warn",
      message: "You are committing to something specific here. Is that yours to promise?",
    });
  }

  const blocked = flags.some((f) => f.severity === "stop");
  const summary = blocked
    ? "Hold on."
    : flags.length > 0
      ? "Send it, but read it once more."
      : words(draft) === 0
        ? "Nothing to send yet."
        : "Looks fine. Send it.";

  return { blocked, flags, summary };
}

export function words(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The points at which the draft is evaluated when recording, and the prefixes a replay
 * can answer. Word boundaries: fine enough that the meters move while you type, coarse
 * enough that recording a sample is a few dozen calls rather than a few hundred.
 */
export function prefixes(text: string): string[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [""];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join(" "));
  return out;
}
