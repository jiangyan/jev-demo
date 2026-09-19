import { describe, expect, it } from "vitest";
import { defaultThresholds, route } from "../src/core/gate.js";
import { answers } from "./helpers.js";

describe("the confidence gate", () => {
  it("automates a confident answer", () => {
    const routing = route(answers({ confidence: 0.95 }));
    expect(routing.disposition).toBe("auto");
    expect(routing.actions).toContain("route:billing");
  });

  it("asks for confirmation in the middle band", () => {
    expect(route(answers({ confidence: 0.7 })).disposition).toBe("confirm");
  });

  it("hands over when the model is not sure", () => {
    expect(route(answers({ confidence: 0.4 })).disposition).toBe("human");
  });

  it("treats the thresholds as inclusive lower bounds", () => {
    expect(route(answers({ confidence: defaultThresholds.autoRoute })).disposition).toBe("auto");
    expect(route(answers({ confidence: defaultThresholds.confirmRoute })).disposition).toBe("confirm");
  });

  it("never automates a suspected security incident, however confident", () => {
    const routing = route(answers({ confidence: 0.999, security: 0.3 }));
    expect(routing.disposition).toBe("human");
    expect(routing.priority).toBe("P0");
    expect(routing.actions[0]).toBe("page:security");
  });

  it("leaves a clean ticket alone when suspicion is below the bar", () => {
    const routing = route(answers({ confidence: 0.95, security: 0.24 }));
    expect(routing.disposition).toBe("auto");
    expect(routing.actions).not.toContain("page:security");
  });

  it("redacts before anything else when personal data may be present", () => {
    const routing = route(answers({ pii: 0.9 }));
    expect(routing.actions[0]).toBe("redact:pii");
  });

  it("flags a refund for billing to approve", () => {
    expect(route(answers({ refund: 0.8 })).actions).toContain("flag:refund-requested");
  });

  it("raises priority for an angry customer without changing the team", () => {
    const calm = route(answers({ severity: 2, frustration: 0 }));
    const angry = route(answers({ severity: 2, frustration: 1.8 }));
    expect(calm.priority).toBe("P1");
    expect(angry.priority).toBe("P0");
    expect(angry.department).toBe(calm.department);
  });

  it("maps severity onto priority", () => {
    expect(route(answers({ severity: 0 })).priority).toBe("P3");
    expect(route(answers({ severity: 1 })).priority).toBe("P2");
    expect(route(answers({ severity: 2 })).priority).toBe("P1");
    expect(route(answers({ severity: 3 })).priority).toBe("P0");
  });

  it("explains itself", () => {
    const routing = route(answers({ confidence: 0.4 }));
    expect(routing.reasons.join(" ")).toMatch(/not sure enough/);
  });

  it("honours custom thresholds", () => {
    const strict = { ...defaultThresholds, autoRoute: 0.99 };
    expect(route(answers({ confidence: 0.95 }), strict).disposition).toBe("confirm");
  });
});
