import { describe, expect, it } from "vitest";
import { normalizeLearningAnswer, selectDailyQuestions, type LearningQuestion } from "../lib/learning_gate_logic";

const questions: LearningQuestion[] = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, section: `s${i}`, prompt: `p${i}`, answers: [`a${i}`] }));

describe("daily learning check", () => {
  it("normalizes harmless formatting differences", () => {
    expect(normalizeLearningAnswer("  Cisco-Calling!! ")).toBe("cisco calling");
  });

  it("assigns three stable, distinct questions per user and day", () => {
    const first = selectDailyQuestions(questions, 7, "2026-08-29");
    const second = selectDailyQuestions(questions, 7, "2026-08-29");
    expect(first.map(q => q.id)).toEqual(second.map(q => q.id));
    expect(new Set(first.map(q => q.id)).size).toBe(3);
  });

  it("rotates the assignment across days", () => {
    expect(selectDailyQuestions(questions, 7, "2026-08-29").map(q => q.id)).not.toEqual(selectDailyQuestions(questions, 7, "2026-08-30").map(q => q.id));
  });
});
