import { describe, expect, it } from "vitest";
import { judge, prefixes, words, type ComposeAnswers } from "../src/core/compose.js";
import { drafts } from "../src/core/drafts.js";
import { standIn } from "../src/core/standin.js";

function sheet(o: Partial<{ tone: number; answered: number; secret: number; promise: number; blame: number }> = {}): ComposeAnswers {
  const { tone = 1, answered = 0.9, secret = 0.02, promise = 0.02, blame = 0.02 } = o;
  return {
    tone: { type: "score", score: tone, confidence: 0.8, legend: {}, probabilities: {} },
    answers_them: { type: "noul", noul: answered },
    contains_secret: { type: "noul", noul: secret },
    makes_promise: { type: "noul", noul: promise },
    blames_reader: { type: "noul", noul: blame },
  } as unknown as ComposeAnswers;
}

const LONG = "a ".repeat(20).trim();

describe("the send gate", () => {
  it("lets an ordinary reply through", () => {
    const v = judge(sheet(), LONG);
    expect(v.blocked).toBe(false);
    expect(v.flags).toHaveLength(0);
    expect(v.summary).toBe("Looks fine. Send it.");
  });

  it("blocks on a suspected credential well below certainty", () => {
    // The cost of sending a live key is not recoverable, so suspicion is enough.
    const v = judge(sheet({ secret: 0.4 }), LONG);
    expect(v.blocked).toBe(true);
    expect(v.flags.map((f) => f.id)).toContain("secret");
  });

  it("blocks a hostile draft but only warns on a clipped one", () => {
    expect(judge(sheet({ tone: 2.5 }), LONG).blocked).toBe(true);
    const clipped = judge(sheet({ tone: 1.8 }), LONG);
    expect(clipped.blocked).toBe(false);
    expect(clipped.flags.map((f) => f.id)).toContain("clipped");
  });

  it("blocks when the draft blames the reader, whatever the tone reads as", () => {
    expect(judge(sheet({ tone: 0.5, blame: 0.7 }), LONG).blocked).toBe(true);
  });

  it("stays quiet about an unanswered question until there is a draft to judge", () => {
    expect(judge(sheet({ answered: 0.1 }), "three words only").flags.map((f) => f.id)).not.toContain("unanswered");
    expect(judge(sheet({ answered: 0.1 }), LONG).flags.map((f) => f.id)).toContain("unanswered");
  });

  it("warns about a promise without blocking it", () => {
    const v = judge(sheet({ promise: 0.8 }), LONG);
    expect(v.blocked).toBe(false);
    expect(v.flags.map((f) => f.id)).toContain("promise");
  });

  it("says there is nothing to send on an empty draft", () => {
    expect(judge(sheet({ answered: 0.05 }), "").summary).toBe("Nothing to send yet.");
  });
});

describe("prefixes", () => {
  it("start empty and end with the whole text", () => {
    const p = prefixes("one two three");
    expect(p[0]).toBe("");
    expect(p.at(-1)).toBe("one two three");
    expect(p).toHaveLength(4);
  });

  it("count words the way the gate does", () => {
    expect(words("")).toBe(0);
    expect(words("   ")).toBe(0);
    expect(words("one  two")).toBe(2);
  });
});

describe("the offline stand-in", () => {
  it("returns the same shape the API does", () => {
    const a = standIn({ they_wrote: "hello", my_reply: "hi there" });
    expect(a.tone.type).toBe("score");
    expect(a.tone.score).toBeGreaterThanOrEqual(0);
    expect(a.tone.score).toBeLessThanOrEqual(3);
    expect(a.contains_secret.noul).toBeGreaterThanOrEqual(0);
    expect(a.contains_secret.noul).toBeLessThanOrEqual(1);
  });

  it("carries each sample draft to the point the scenario promises", () => {
    const verdict = (id: string) => {
      const d = drafts.find((x) => x.id === id)!;
      return judge(standIn({ they_wrote: d.theyWrote, my_reply: d.reply }), d.reply);
    };

    expect(verdict("double-charge").flags.map((f) => f.id)).toContain("tone");
    expect(verdict("leaked-key").flags.map((f) => f.id)).toContain("secret");
    expect(verdict("over-promise").flags.map((f) => f.id)).toContain("promise");
    expect(verdict("double-charge").blocked).toBe(true);
    expect(verdict("leaked-key").blocked).toBe(true);
  });

  it("only flags the missed question part-way through the draft that misses it", () => {
    const d = drafts.find((x) => x.id === "never-answers")!;
    const steps = prefixes(d.reply);
    const flagged = (text: string) =>
      judge(standIn({ they_wrote: d.theyWrote, my_reply: text }), text).flags.some((f) => f.id === "unanswered");

    expect(flagged(steps[Math.floor(steps.length / 2)]!)).toBe(true);
    expect(flagged(d.reply)).toBe(false);
  });

  it("never claims certainty", () => {
    const a = standIn({ they_wrote: "x", my_reply: "you should have checked. obviously. as i said." });
    expect(a.blames_reader.noul).toBeLessThan(1);
    expect(a.answers_them.noul).toBeLessThan(1);
  });
});
