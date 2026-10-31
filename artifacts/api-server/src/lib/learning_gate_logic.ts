export type LearningQuestion = { id: string; section: string; prompt: string; answers: string[] };

export const normalizeLearningAnswer = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();

export function selectDailyQuestions(questions: LearningQuestion[], userId: number, day: string) {
  let seed = userId;
  for (const c of day) seed = ((seed * 31) + c.charCodeAt(0)) >>> 0;
  const pool = [...questions];
  for (let i = pool.length - 1; i > 0; i--) { seed = (seed * 1664525 + 1013904223) >>> 0; const j = seed % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}
