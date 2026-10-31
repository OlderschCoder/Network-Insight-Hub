import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "./auth";
import { normalizeLearningAnswer, selectDailyQuestions } from "../lib/learning_gate_logic";

const router = Router();

const QUESTIONS = [
  { id: "network-map", section: "Network", prompt: "Which page shows switch-to-switch paths and campus topology?", answers: ["network map", "/network/map"] },
  { id: "buildings-health", section: "Buildings", prompt: "Which page combines devices, VLANs, links, and building health?", answers: ["buildings", "network buildings", "/network/buildings"] },
  { id: "monitoring-live", section: "Monitoring", prompt: "Where do you check current reachability, alerts, and last-seen telemetry?", answers: ["monitoring", "/monitoring"] },
  { id: "phones", section: "Cisco Calling", prompt: "Which IT App shows current building-assigned phone status?", answers: ["cisco calling", "/it-apps/cisco-calling"] },
  { id: "azure", section: "Azure", prompt: "Which section shows the current Azure resource inventory?", answers: ["azure inventory", "/azure-inventory"] },
  { id: "banner", section: "Banner / EUP", prompt: "Which section shows Banner and EUP provisioning activity?", answers: ["banner", "/banner"] },
  { id: "incidents", section: "Incidents", prompt: "Where should active troubleshooting and its timeline be coordinated?", answers: ["incidents", "incident room", "/incidents"] },
  { id: "risks", section: "Risks", prompt: "Where are unresolved operational risks and mitigations recorded?", answers: ["risks", "risks and issues", "/risks"] },
  { id: "projects", section: "Projects", prompt: "Which section tracks project status and progress?", answers: ["projects", "/projects"] },
  { id: "reports", section: "Reports", prompt: "Which section contains team and executive reporting records?", answers: ["reports", "/reports"] },
  { id: "processes", section: "Processes", prompt: "Where are reusable operational runbooks stored?", answers: ["processes", "process library", "/processes"] },
  { id: "guide", section: "User Guide", prompt: "Where can you find step-by-step instructions for using the Hub?", answers: ["user guide", "/user-guide"] },
  { id: "fred", section: "Fred", prompt: "What should you attach to Fred when you want current console output analyzed?", answers: ["console output", "command output", "text file", "paste the output", "pasted output"] },
];

const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function progress(userId: number, role: string) {
  const day = dayKey();
  const picked = selectDailyQuestions(QUESTIONS, userId, day);
  const result: any = await db.execute(sql`
    SELECT question_id FROM learning_gate_answers WHERE user_id=${userId} AND learning_day=${day}::date AND correct=true
  `);
  const correct = new Set((result.rows ?? result).map((r: any) => r.question_id));
  const pagesResult: any = await db.execute(sql`
    SELECT count(DISTINCT path)::int AS count FROM product_usage_events
    WHERE user_id=${userId} AND event_type='page_view' AND created_at >= now() - interval '3 days'
  `);
  const streakResult: any = await db.execute(sql`
    WITH days AS (SELECT DISTINCT learning_day FROM learning_gate_answers WHERE user_id=${userId} AND correct=true GROUP BY learning_day HAVING count(DISTINCT question_id)>=3)
    SELECT count(*)::int AS count FROM days WHERE learning_day >= current_date - interval '2 days'
  `);
  const distinctPages = Number((pagesResult.rows ?? pagesResult)[0]?.count ?? 0);
  const streakDays = Number((streakResult.rows ?? streakResult)[0]?.count ?? 0);
  const dailyComplete = picked.every(q => correct.has(q.id));
  return { day, dailyComplete, correctToday: picked.filter(q => correct.has(q.id)).length, requiredToday: 3, distinctPages, requiredPages: 8, streakDays, requiredStreak: 3, coachingComplete: dailyComplete && distinctPages >= 8 && streakDays >= 3, adminBypass: role === "cio", questions: picked.map(q => ({ id: q.id, section: q.section, prompt: q.prompt, correct: correct.has(q.id) })) };
}

router.get("/status", requireAuth, async (req: any, res: Response) => res.json(await progress(req.user.id, req.user.role)));
router.post("/answer", requireAuth, async (req: any, res: Response) => {
  const day = dayKey();
  const question = selectDailyQuestions(QUESTIONS, req.user.id, day).find(q => q.id === req.body?.questionId);
  if (!question) return res.status(400).json({ error: "Question is not assigned today." });
  const given = normalizeLearningAnswer(req.body?.answer);
  const correct = given.length > 0 && question.answers.some(a => { const expected = normalizeLearningAnswer(a); return given === expected || given.includes(expected); });
  await db.execute(sql`INSERT INTO learning_gate_answers (user_id, learning_day, question_id, answer, correct) VALUES (${req.user.id}, ${day}::date, ${question.id}, ${String(req.body?.answer ?? "").slice(0, 500)}, ${correct}) ON CONFLICT (user_id, learning_day, question_id) DO UPDATE SET answer=excluded.answer, correct=(learning_gate_answers.correct OR excluded.correct), answered_at=now()`);
  res.json({ correct, ...(await progress(req.user.id, req.user.role)) });
});

export default router;
