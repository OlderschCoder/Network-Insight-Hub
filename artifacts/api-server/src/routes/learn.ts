import { Router, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "./auth";
import { LEARN_SCENARIOS, evaluateLearnChoice, getLearnScenario } from "../lib/learn_scenarios";
import { getOpenAI, isAIConfigured } from "../lib/openai";

const router = Router();

async function progressRows(userId: number) {
  const result: any = await db.execute(sql`SELECT scenario_id, current_step, status, attempts, history, started_at, completed_at, updated_at FROM learn_scenario_progress WHERE user_id=${userId}`);
  return result.rows ?? result;
}

router.get("/scenarios", requireAuth, async (req: any, res: Response) => {
  const rows = await progressRows(req.user.id);
  const byId = new Map(rows.map((r: any) => [r.scenario_id, r]));
  const scenarios = LEARN_SCENARIOS.map(s => {
    const p: any = byId.get(s.id);
    return { id: s.id, title: s.title, mode: s.mode, summary: s.summary, sections: s.sections, minutes: s.minutes, totalSteps: s.steps.length, currentStep: Number(p?.current_step ?? 0), status: p?.status ?? "not_started", attempts: Number(p?.attempts ?? 0), completedAt: p?.completed_at ?? null };
  });
  res.json({ completed: scenarios.filter(s => s.status === "completed").length, total: scenarios.length, scenarios });
});

router.get("/scenarios/:id", requireAuth, async (req: any, res: Response) => {
  const scenario = getLearnScenario(req.params.id);
  if (!scenario) return res.status(404).json({ error: "Scenario not found" });
  const rows = await progressRows(req.user.id);
  const p: any = rows.find((r: any) => r.scenario_id === scenario.id);
  const currentStep = Math.min(Number(p?.current_step ?? 0), scenario.steps.length - 1);
  const step = scenario.steps[currentStep];
  res.json({ id: scenario.id, title: scenario.title, mode: scenario.mode, summary: scenario.summary, sections: scenario.sections, minutes: scenario.minutes, totalSteps: scenario.steps.length, currentStep, status: p?.status ?? "not_started", attempts: Number(p?.attempts ?? 0), history: p?.history ?? [], step: { ...step, choices: step.choices.map(c => ({ label: c.label })) } });
});

router.post("/scenarios/:id/start", requireAuth, async (req: any, res: Response) => {
  const scenario = getLearnScenario(req.params.id);
  if (!scenario) return res.status(404).json({ error: "Scenario not found" });
  await db.execute(sql`INSERT INTO learn_scenario_progress (user_id, scenario_id, current_step, status, attempts, history) VALUES (${req.user.id}, ${scenario.id}, 0, 'in_progress', 0, '[]'::jsonb) ON CONFLICT (user_id, scenario_id) DO UPDATE SET current_step=CASE WHEN learn_scenario_progress.status='completed' THEN 0 ELSE learn_scenario_progress.current_step END, status='in_progress', attempts=CASE WHEN learn_scenario_progress.status='completed' THEN 0 ELSE learn_scenario_progress.attempts END, history=CASE WHEN learn_scenario_progress.status='completed' THEN '[]'::jsonb ELSE learn_scenario_progress.history END, started_at=CASE WHEN learn_scenario_progress.status='completed' THEN now() ELSE learn_scenario_progress.started_at END, completed_at=NULL, updated_at=now()`);
  res.json({ ok: true });
});

router.post("/scenarios/:id/respond", requireAuth, async (req: any, res: Response) => {
  const scenario = getLearnScenario(req.params.id);
  const choiceIndex = Number(req.body?.choiceIndex);
  if (!scenario || !Number.isInteger(choiceIndex)) return res.status(400).json({ error: "Valid scenario and choice are required" });
  const rows = await progressRows(req.user.id);
  const p: any = rows.find((r: any) => r.scenario_id === scenario.id);
  const stepIndex = Math.min(Number(p?.current_step ?? 0), scenario.steps.length - 1);
  const evaluation = evaluateLearnChoice(scenario, stepIndex, choiceIndex);
  if (!evaluation) return res.status(400).json({ error: "Choice is not valid for this step" });
  const nextStep = evaluation.advance ? stepIndex + 1 : stepIndex;
  const completed = evaluation.advance && nextStep >= scenario.steps.length;
  const event = JSON.stringify({ step: stepIndex, choice: choiceIndex, correct: evaluation.correct, at: new Date().toISOString() });
  await db.execute(sql`INSERT INTO learn_scenario_progress (user_id, scenario_id, current_step, status, attempts, history) VALUES (${req.user.id}, ${scenario.id}, ${completed ? scenario.steps.length : nextStep}, ${completed ? "completed" : "in_progress"}, 1, jsonb_build_array(${event}::jsonb)) ON CONFLICT (user_id, scenario_id) DO UPDATE SET current_step=${completed ? scenario.steps.length : nextStep}, status=${completed ? "completed" : "in_progress"}, attempts=learn_scenario_progress.attempts+1, history=learn_scenario_progress.history || jsonb_build_array(${event}::jsonb), completed_at=CASE WHEN ${completed} THEN now() ELSE learn_scenario_progress.completed_at END, updated_at=now()`);
  res.json({ ...evaluation, completed, nextStep: completed ? scenario.steps.length : nextStep });
});

router.post("/scenarios/:id/coach", requireAuth, async (req: any, res: Response) => {
  if (!isAIConfigured()) return res.status(503).json({ error: "Fred is not configured" });
  const scenario = getLearnScenario(req.params.id);
  const message = String(req.body?.message ?? "").trim().slice(0, 2000);
  const checkRevealed = req.body?.checkRevealed === true;
  if (!scenario || !message) return res.status(400).json({ error: "Scenario and message are required" });
  const rows = await progressRows(req.user.id);
  const p: any = rows.find((r: any) => r.scenario_id === scenario.id);
  const stepIndex = Math.min(Number(p?.current_step ?? 0), scenario.steps.length - 1);
  const step = scenario.steps[stepIndex];
  const trainingNotice = "*TRAINING EXERCISE — frozen simulation, not a live incident*";
  const systemPrompt = `${trainingNotice}\nYou are Fred acting only as a training coach inside SCCC IT Learn. This conversation cannot access or change production systems. Never claim that a simulated observation is live. Never create tasks, modify records, run tools, or instruct the learner to make a production change.\n\nThe learner is not assumed to know diagnostic questions, commands, or engineering terminology. Teach one diagnostic question at a time in plain language, explain why it matters, and help the learner reason from evidence already unlocked. Do not reveal the correct choice, final diagnosis, future evidence, or resolution. Do not answer the exercise for them. If asked directly for the answer, respond with a useful question or hint tied to the current step. Every response must begin exactly with the training notice.\n\nScenario: ${scenario.title}\nMode: ${scenario.mode === "desk" ? "At My Desk" : "Onsite"}\nCurrent step: ${step.title}\nSituation: ${step.situation}\nCoach objective: ${step.coach}\nRelevant Hub section: ${step.pageLabel}\nQuestion being worked: ${step.question}\n${checkRevealed ? `Unlocked simulated observation: ${step.evidence}` : "The simulated observation has not been unlocked. Do not disclose or infer it."}`;
  const completion = await getOpenAI().chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 800,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: message }],
  });
  let reply = completion.choices[0]?.message?.content?.trim() || "I could not generate a training response.";
  if (!reply.startsWith(trainingNotice)) reply = `${trainingNotice}\n\n${reply}`;
  res.json({ reply, training: true, scenarioId: scenario.id, step: stepIndex });
});

router.post("/scenarios/:id/reset", requireAuth, async (req: any, res: Response) => {
  const scenario = getLearnScenario(req.params.id);
  if (!scenario) return res.status(404).json({ error: "Scenario not found" });
  await db.execute(sql`DELETE FROM learn_scenario_progress WHERE user_id=${req.user.id} AND scenario_id=${scenario.id}`);
  res.json({ ok: true });
});

export default router;
