import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TypeSafeClient, type SystemOneResult } from "@typesafe-ai/sdk";
import { decisionSheet, type DecisionSheet } from "./questions.js";
import { loadCassette, questionsFingerprint, replayFetch, type Cassette } from "./cassette.js";
import type { Ticket } from "./tickets.js";

export type Mode = "live" | "replay";

export const CASSETTE_PATH = fileURLToPath(new URL("../../fixtures/cassette.json", import.meta.url));

export interface Session {
  mode: Mode;
  client: TypeSafeClient;
  /** Present in replay mode. Carries whether the answers were recorded or synthesised. */
  cassette?: Cassette;
  /** Set when the cassette was captured against a different question set. */
  staleCassette: boolean;
}

export interface OpenOptions {
  /** Force a mode. Without it: live when `TYPESAFE_API_KEY` is set, replay otherwise. */
  mode?: Mode;
  cassettePath?: string;
}

/**
 * Open a session against Jev, live or replayed.
 *
 * Both modes return the same `TypeSafeClient`, so everything downstream -- request
 * shaping, types, parsing, errors -- is identical. Only the transport differs.
 */
export function openSession(options: OpenOptions = {}): Session {
  const path = options.cassettePath ?? CASSETTE_PATH;
  const hasKey = Boolean(process.env["TYPESAFE_API_KEY"]?.trim());
  const mode: Mode = options.mode ?? (hasKey ? "live" : "replay");

  if (mode === "live") {
    if (!hasKey) {
      throw new Error("Live mode needs TYPESAFE_API_KEY. Copy .env.example to .env, or run with --replay.");
    }
    return { mode, client: new TypeSafeClient(), staleCassette: false };
  }

  if (!existsSync(path)) {
    throw new Error(`No cassette at ${path}. Run \`npm run record\` with a key, or restore the checked-in fixtures.`);
  }

  const cassette = loadCassette(path);
  const client = new TypeSafeClient({
    // The SDK requires a key even when nothing leaves the process.
    apiKey: "replay-no-network",
    fetch: replayFetch(cassette),
    retry: { maxRetries: 0 },
  });

  return {
    mode,
    client,
    cassette,
    staleCassette: cassette.questionsFingerprint !== questionsFingerprint(decisionSheet),
  };
}

/** The state Jev is asked to evaluate. A JSON object, not a flattened string. */
export function stateFor(ticket: Ticket): { subject: string; body: string } {
  return { subject: ticket.subject, body: ticket.body };
}

export interface Decision extends SystemOneResult<DecisionSheet> {
  /** Wall-clock milliseconds for the call. Meaningless in replay mode: nothing leaves the process. */
  ms: number;
}

/** One ticket, one call, six typed answers. */
export async function ask(session: Session, ticket: Ticket): Promise<Decision> {
  const started = performance.now();
  const result = await session.client.systemOne({
    state: stateFor(ticket),
    questions: decisionSheet,
  });
  return { ...result, ms: performance.now() - started };
}
