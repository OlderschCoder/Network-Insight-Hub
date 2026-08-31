import { describe, expect, it } from "vitest";
import { LEARN_SCENARIOS, evaluateLearnChoice, getLearnScenario } from "./learn_scenarios";

describe("Learn simulations", () => {
  it("covers the major Hub sections through real-world scenarios", () => {
    const sections = new Set(LEARN_SCENARIOS.flatMap(s => s.sections));
    for (const expected of ["Buildings", "Monitoring", "Cisco Calling", "Banner", "Azure", "Incident Rooms", "Risks", "Process Library", "After-Action", "Weekly Log"]) expect(sections.has(expected)).toBe(true);
  });

  it("provides both desk-based and onsite practice", () => {
    expect(LEARN_SCENARIOS.some(s => s.mode === "desk")).toBe(true);
    expect(LEARN_SCENARIOS.some(s => s.mode === "onsite")).toBe(true);
  });

  it("provides coaching, a Hub destination, evidence, and choices for every step", () => {
    for (const scenario of LEARN_SCENARIOS) for (const step of scenario.steps) {
      expect(step.coach.length).toBeGreaterThan(20);
      expect(step.pageHref.startsWith("/")).toBe(true);
      expect(step.evidence.length).toBeGreaterThan(10);
      expect(step.choices.length).toBeGreaterThanOrEqual(2);
      expect(step.choices.filter(c => c.correct)).toHaveLength(1);
    }
  });

  it("advances only on the coached diagnostic choice", () => {
    const scenario = getLearnScenario("gym-no-wifi")!;
    expect(evaluateLearnChoice(scenario, 0, 0)).toMatchObject({ correct: true, advance: true });
    expect(evaluateLearnChoice(scenario, 0, 1)).toMatchObject({ correct: false, advance: false });
  });
});
