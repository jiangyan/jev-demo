import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { composeSheet, type ComposeAnswers, type ComposeState } from "./compose.js";
import { loadCassette, replayFetch, type Cassette } from "./cassette.js";
import { standIn } from "./standin.js";

export const COMPOSE_CASSETTE = fileURLToPath(new URL("../../fixtures/compose-cassette.json", import.meta.url));

/** Where a given answer came from. Shown in the interface, never hidden. */
export type Source = "live" | "recorded" | "stand-in";

export interface ComposeReading {
  answers: ComposeAnswers;
  source: Source;
  /** Round-trip milliseconds. Only meaningful for `live`. */
  ms: number;
}

export interface ComposeEngine {
  /** What this engine will use when it can. */
  preferred: Source;
  /** True when a recording exists and was captured for the current question set. */
  hasRecording: boolean;
  read(state: ComposeState, signal?: AbortSignal): Promise<ComposeReading>;
}

/**
 * Resolve a draft to answers, preferring the most truthful source available:
 * the live model, then a recording of the live model, then the stand-in.
 *
 * The fallbacks are not silent. Every reading says where it came from, and the
 * interface says so too, because a demo that quietly substitutes a keyword matcher
 * for a model is worse than no demo.
 */
export function openComposeEngine(options: { live?: boolean } = {}): ComposeEngine {
  const hasKey = Boolean(process.env["TYPESAFE_API_KEY"]?.trim());
  const live = options.live ?? hasKey;
  const hasRecording = existsSync(COMPOSE_CASSETTE);

  if (live) {
    if (!hasKey) throw new Error("Live mode needs TYPESAFE_API_KEY.");
    const client = new TypeSafeClient({ timeout: 4000, retry: { maxRetries: 1 } });
    return {
      preferred: "live",
      hasRecording,
      async read(state, signal) {
        const started = performance.now();
        const result = await client.systemOne(
          { state: state as unknown as Record<string, string>, questions: composeSheet },
          signal ? { signal } : {},
        );
        return { answers: result.answers, source: "live", ms: performance.now() - started };
      },
    };
  }

  let cassette: Cassette | undefined;
  let replayClient: TypeSafeClient | undefined;
  if (hasRecording) {
    cassette = loadCassette(COMPOSE_CASSETTE);
    replayClient = new TypeSafeClient({
      apiKey: "replay-no-network",
      fetch: replayFetch(cassette),
      retry: { maxRetries: 0 },
    });
  }

  return {
    preferred: hasRecording ? "recorded" : "stand-in",
    hasRecording,
    async read(state) {
      if (replayClient) {
        try {
          const started = performance.now();
          const result = await replayClient.systemOne({
            state: state as unknown as Record<string, string>,
            questions: composeSheet,
          });
          return { answers: result.answers, source: "recorded", ms: performance.now() - started };
        } catch {
          // Nothing recorded for this exact draft. Fall through and say so.
        }
      }
      return { answers: standIn(state), source: "stand-in", ms: 0 };
    },
  };
}
