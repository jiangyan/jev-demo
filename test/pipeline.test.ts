import { describe, expect, it } from "vitest";
import { ask, openSession } from "../src/core/client.js";
import { questionsFingerprint } from "../src/core/cassette.js";
import { route } from "../src/core/gate.js";
import { decisionSheet } from "../src/core/questions.js";
import { tickets } from "../src/core/tickets.js";

// Replay explicitly: a key in the environment must not turn this into a live,
// billable test run.
const session = openSession({ mode: "replay" });

describe("the checked-in cassette", () => {
  it("was captured for the question set in the repository", () => {
    expect(session.cassette?.questionsFingerprint).toBe(questionsFingerprint(decisionSheet));
    expect(session.staleCassette).toBe(false);
  });

  it("covers every ticket in the queue", () => {
    expect(Object.keys(session.cassette?.entries ?? {})).toHaveLength(tickets.length);
  });

  it("says plainly where its answers came from", () => {
    // Passes either way, and insists the cassette is honest about which way it is.
    // A synthetic cassette must say so loudly; a real recording must name its source.
    const generator = session.cassette?.generator;
    expect(["synthetic", "recorded"]).toContain(generator);
    expect(session.cassette?.note).toMatch(
      generator === "synthetic" ? /NOT RECORDED FROM JEV/i : /recorded from/i,
    );
  });
});

describe("the pipeline end to end", () => {
  it("produces a decision for every ticket", async () => {
    for (const ticket of tickets) {
      const { answers } = await ask(session, ticket);
      const routing = route(answers);

      expect(routing.department).toBeTypeOf("string");
      expect(routing.confidence).toBeGreaterThan(0);
      expect(routing.confidence).toBeLessThanOrEqual(1);
      expect(routing.actions.length).toBeGreaterThan(0);
      expect(routing.reasons.length).toBeGreaterThan(0);
      expect(["auto", "confirm", "human"]).toContain(routing.disposition);
    }
  });

  it("hands over every ticket the model flags as a security incident", async () => {
    for (const ticket of tickets) {
      const { answers } = await ask(session, ticket);
      if (answers.security_incident.noul >= 0.25) {
        expect(route(answers).disposition).toBe("human");
      }
    }
  });

  it("returns probabilities that sum to one", async () => {
    const { answers } = await ask(session, tickets[0]!);
    const total = Object.values(answers.department.probabilities).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
  });
});
