import { describe, expect, it } from "vitest";
import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import { questionsFingerprint, replayFetch, stateKey, type Cassette } from "../src/core/cassette.js";

const state = { subject: "Charged twice", body: "Please refund one." };

const cassette: Cassette = {
  generator: "synthetic",
  createdAt: "2026-01-01T00:00:00.000Z",
  model: "jev-latest",
  questionsFingerprint: "x",
  note: "test",
  entries: {
    [stateKey(state)]: {
      label: "T-1 Charged twice",
      response: {
        model: "jev-1.0.0",
        answers: { refund: { type: "noul", noul: 0.91 } },
        usage: { input_tokens: 120, output_tokens: 8 },
      },
    },
  },
};

function client(): TypeSafeClient {
  return new TypeSafeClient({ apiKey: "test", fetch: replayFetch(cassette), retry: { maxRetries: 0 } });
}

describe("state keys", () => {
  it("ignore the order the state was written in", () => {
    expect(stateKey({ a: 1, b: 2 })).toBe(stateKey({ b: 2, a: 1 }));
  });

  it("change when the state changes", () => {
    expect(stateKey({ a: 1 })).not.toBe(stateKey({ a: 2 }));
  });

  it("handle a bare string as well as an object", () => {
    expect(stateKey("hello")).toHaveLength(16);
  });
});

describe("question fingerprints", () => {
  it("survive reordering but not rewording", () => {
    const a = { one: noul("Is it urgent?"), two: noul("Is it billing?") };
    const b = { two: noul("Is it billing?"), one: noul("Is it urgent?") };
    const c = { one: noul("Is it URGENT?"), two: noul("Is it billing?") };
    expect(questionsFingerprint(a)).toBe(questionsFingerprint(b));
    expect(questionsFingerprint(a)).not.toBe(questionsFingerprint(c));
  });
});

describe("replay through the real SDK", () => {
  it("parses a recorded answer into the SDK's own types", async () => {
    const result = await client().systemOne({ state, questions: { refund: noul("Refund asked for?") } });
    expect(result.answers.refund.noul).toBe(0.91);
    expect(result.model).toBe("jev-1.0.0");
    expect(result.usage.input_tokens).toBe(120);
  });

  it("fails loudly, and usefully, on a state it has never seen", async () => {
    await expect(
      client().systemOne({ state: { subject: "unknown", body: "?" }, questions: { refund: noul("?") } }),
    ).rejects.toThrow(/No recorded answer|404/);
  });

  it("makes no network call", async () => {
    // The fetch handed to the client is the only transport; if it were bypassed
    // this would try to reach the real API and fail differently.
    let calls = 0;
    const counting = new TypeSafeClient({
      apiKey: "test",
      retry: { maxRetries: 0 },
      fetch: async (input, init) => {
        calls += 1;
        return replayFetch(cassette)(input, init);
      },
    });
    await counting.systemOne({ state, questions: { refund: noul("?") } });
    expect(calls).toBe(1);
  });
});
