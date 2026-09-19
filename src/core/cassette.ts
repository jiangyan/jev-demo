import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { EntryType, Fetch, Questions } from "@typesafe-ai/sdk";

/**
 * A recorded set of API responses, keyed by the state that produced them.
 *
 * The same idea as an HTTP replay cassette: the demo talks to the real SDK either
 * way, and only the transport underneath it changes. That matters, because it
 * means offline mode exercises the genuine request building, response parsing and
 * error handling rather than a hand-rolled stand-in.
 */
export interface Cassette {
  /** `recorded` came from the real API. `synthetic` was generated locally and proves nothing about the model. */
  generator: "recorded" | "synthetic";
  createdAt: string;
  model: string;
  /** Fingerprint of the question set these answers were produced for. */
  questionsFingerprint: string;
  note: string;
  entries: Record<string, CassetteEntry>;
}

export interface CassetteEntry {
  /** Human-readable hint so the file can be read by a person. Not used for lookup. */
  label: string;
  response: unknown;
}

/** JSON with object keys sorted, so equal values hash equally. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Lookup key for one request's state. */
export function stateKey(state: EntryType): string {
  return sha256(canonical(state)).slice(0, 16);
}

/**
 * Fingerprint of the question set. Stored on the cassette so replay can warn when
 * the questions have been edited since the answers were captured -- at which point
 * the answers are for a different question and mean nothing.
 */
export function questionsFingerprint(questions: Questions): string {
  return sha256(canonical(questions)).slice(0, 16);
}

export function loadCassette(path: string): Cassette {
  return JSON.parse(readFileSync(path, "utf8")) as Cassette;
}

/**
 * A `fetch` implementation that answers from a cassette instead of the network.
 * Handed to `new TypeSafeClient({ fetch })`, which is the SDK's own seam for this.
 */
export function replayFetch(cassette: Cassette): Fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    if (!url.endsWith("/v1/systemone")) {
      return json({ error: { message: `Replay only serves /v1/systemone, not ${url}` } }, 404);
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as { state?: EntryType };
    const key = stateKey(body.state ?? null);
    const hit = cassette.entries[key];

    if (!hit) {
      return json(
        {
          error: {
            message:
              `No recorded answer for this state (key ${key}). ` +
              `The cassette has ${Object.keys(cassette.entries).length} entries. ` +
              `Run \`npm run record\` with TYPESAFE_API_KEY set to capture it.`,
          },
        },
        404,
      );
    }

    return json(hit.response, 200);
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-typesafe-request-id": "replay" },
  });
}
