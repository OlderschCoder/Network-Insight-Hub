import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { ArrowLeft, BookOpenCheck, CheckCircle2, Clock3, ExternalLink, Loader2, MessageSquare, RotateCcw, Send, ShieldCheck } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");
const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}`, "Content-Type": "application/json" });

type ScenarioMode = "desk" | "onsite";
type ScenarioSummary = { id: string; title: string; mode: ScenarioMode; summary: string; sections: string[]; minutes: number; totalSteps: number; currentStep: number; status: string; attempts: number };
type ScenarioDetail = { id: string; title: string; mode: ScenarioMode; summary: string; sections: string[]; minutes: number; totalSteps: number; currentStep: number; status: string; attempts: number; history: unknown[]; step: { title: string; situation: string; coach: string; pageLabel: string; pageHref: string; evidence: string; question: string; choices: Array<{ label: string }> } };

export default function LearnPage() {
  const [list, setList] = useState<{ completed: number; total: number; scenarios: ScenarioSummary[] } | null>(null);
  const [active, setActive] = useState<ScenarioDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ correct: boolean; result: string; completed: boolean } | null>(null);
  const [checkRevealed, setCheckRevealed] = useState(false);
  const [coachInput, setCoachInput] = useState("");
  const [coachBusy, setCoachBusy] = useState(false);
  const [coachMessages, setCoachMessages] = useState<Array<{ role: "user" | "fred"; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const loadList = async () => { const r = await fetch(`${API_BASE}/learn/scenarios`, { headers: headers() }); if (!r.ok) throw new Error("Could not load Learn scenarios"); setList(await r.json()); };
  const loadScenario = async (id: string) => { const r = await fetch(`${API_BASE}/learn/scenarios/${id}`, { headers: headers() }); if (!r.ok) throw new Error("Could not load scenario"); setActive(await r.json()); setFeedback(null); setCheckRevealed(false); setCoachMessages([]); };
  useEffect(() => { loadList().catch(e => setError(e.message)); }, []);
  const start = async (id: string) => { setBusy(true); await fetch(`${API_BASE}/learn/scenarios/${id}/start`, { method: "POST", headers: headers() }); await loadScenario(id); setBusy(false); };
  const respond = async (choiceIndex: number) => { if (!active) return; setBusy(true); const r = await fetch(`${API_BASE}/learn/scenarios/${active.id}/respond`, { method: "POST", headers: headers(), body: JSON.stringify({ choiceIndex }) }); const data = await r.json(); setFeedback(data); if (data.correct && !data.completed) window.setTimeout(() => void loadScenario(active.id), 1100); if (data.completed) await loadList(); setBusy(false); };
  const reset = async () => { if (!active) return; setBusy(true); await fetch(`${API_BASE}/learn/scenarios/${active.id}/reset`, { method: "POST", headers: headers() }); await loadScenario(active.id); await loadList(); setBusy(false); };
  const askCoach = async () => { if (!active || !coachInput.trim()) return; const text = coachInput.trim(); setCoachInput(""); setCoachMessages(v => [...v, { role: "user", text }]); setCoachBusy(true); const r = await fetch(`${API_BASE}/learn/scenarios/${active.id}/coach`, { method: "POST", headers: headers(), body: JSON.stringify({ message: text, checkRevealed }) }); const data = await r.json(); setCoachMessages(v => [...v, { role: "fred", text: data.reply ?? "*TRAINING EXERCISE* Fred could not respond." }]); setCoachBusy(false); };

  if (error) return <Card><CardContent className="pt-6 text-destructive">{error}</CardContent></Card>;
  if (!list) return <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  if (active) {
    const complete = feedback?.completed || active.status === "completed";
    return <div className="mx-auto max-w-4xl space-y-5">
      <Button variant="ghost" onClick={() => { setActive(null); setFeedback(null); void loadList(); }}><ArrowLeft className="mr-2 h-4 w-4" />Back to Learn</Button>
      <div><h1 className="text-3xl font-bold">{active.title}</h1><p className="mt-1 text-muted-foreground">{active.summary}</p></div>
      <Progress value={complete ? 100 : (active.currentStep / active.totalSteps) * 100} />
      {complete ? <Card className="border-emerald-300 bg-emerald-50/50"><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-6 w-6 text-emerald-600" />Scenario complete</CardTitle><CardDescription>You followed the evidence, narrowed the fault domain, and created an actionable outcome.</CardDescription></CardHeader><CardContent className="flex gap-2"><Button onClick={() => { setActive(null); void loadList(); }}>Choose another scenario</Button><Button variant="outline" onClick={() => void reset()}><RotateCcw className="mr-2 h-4 w-4" />Run again</Button></CardContent></Card> : <>
        <div className="flex flex-wrap gap-2"><Badge>{active.mode === "desk" ? "At My Desk" : "Onsite"}</Badge><Badge variant="outline">Step {active.currentStep + 1} of {active.totalSteps}</Badge>{active.sections.map(s => <Badge key={s} variant="outline">{s}</Badge>)}</div>
        <Card><CardHeader><CardTitle>{active.step.title}</CardTitle><CardDescription className="text-base text-foreground">{active.step.situation}</CardDescription></CardHeader><CardContent className="space-y-5">
          <div className="rounded-md border-l-4 border-blue-500 bg-blue-50 p-4"><div className="font-semibold">Fred coaches the diagnostic question</div><p className="mt-1 text-sm">{active.step.coach}</p></div>
          <div className="rounded-md border p-4"><div className="flex items-center gap-2 font-semibold"><MessageSquare className="h-4 w-4" />Ask Fred during this step</div><p className="mt-1 text-xs font-semibold text-blue-700">TRAINING EXERCISE — frozen simulation, not a live incident</p><p className="mt-1 text-sm text-muted-foreground">Fred can explain terminology and help you form the next diagnostic question. She cannot see hidden evidence, reveal the answer, use production tools, or change records.</p>{coachMessages.length > 0 && <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded bg-muted/60 p-3">{coachMessages.map((m, i) => <div key={i} className={m.role === "fred" ? "text-sm" : "text-sm font-medium text-right"}><span className="whitespace-pre-wrap">{m.text}</span></div>)}</div>}<div className="mt-3 flex gap-2"><Input value={coachInput} onChange={e => setCoachInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void askCoach(); }} placeholder="I don't know what to ask next…" /><Button onClick={() => void askCoach()} disabled={coachBusy || !coachInput.trim()}>{coachBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button></div></div>
          <div className="rounded-md bg-muted p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">Work the diagnostic step</div><p className="mt-1 text-sm">Open the relevant Hub section, follow Fred’s coaching above, then return and run the simulated check. The predetermined outcome is not shown until you perform this step.</p><div className="mt-3 flex flex-wrap gap-2"><Button asChild variant="outline"><a href={active.step.pageHref} target="_blank" rel="noreferrer">Open {active.step.pageLabel}<ExternalLink className="ml-2 h-3 w-3" /></a></Button><Button onClick={() => setCheckRevealed(true)} disabled={checkRevealed}>{checkRevealed ? "Check completed" : "Run simulated check"}</Button></div>{checkRevealed && <div className="mt-4 rounded border bg-background p-3"><div className="text-xs font-semibold uppercase text-muted-foreground">Observed result</div><p className="mt-1">{active.step.evidence}</p></div>}</div>
          <div><h2 className="mb-3 text-lg font-semibold">{active.step.question}</h2>{!checkRevealed && <p className="mb-3 text-sm text-muted-foreground">Complete the diagnostic check before interpreting the result.</p>}<div className="grid gap-2">{active.step.choices.map((choice, i) => <Button key={i} variant="outline" className="h-auto justify-start whitespace-normal py-3 text-left" disabled={busy || feedback?.correct || !checkRevealed} onClick={() => void respond(i)}>{choice.label}</Button>)}</div></div>
          {feedback && <div className={`rounded-md p-4 ${feedback.correct ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}><strong>{feedback.correct ? "Good diagnostic move." : "That would send the investigation sideways."}</strong><p className="mt-1 text-sm">{feedback.result}</p>{feedback.correct && !feedback.completed && <p className="mt-2 text-xs">Moving to the next step…</p>}</div>}
        </CardContent></Card>
      </>}
    </div>;
  }

  const renderGroup = (mode: ScenarioMode, title: string, description: string) => <section className="space-y-3"><div><h2 className="text-2xl font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.scenarios.filter(s => s.mode === mode).map(s => <Card key={s.id} className="flex flex-col"><CardHeader><div className="flex items-start justify-between gap-2"><CardTitle>{s.title}</CardTitle>{s.status === "completed" && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}</div><CardDescription>{s.summary}</CardDescription></CardHeader><CardContent className="mt-auto space-y-4"><div className="flex flex-wrap gap-1">{s.sections.map(section => <Badge key={section} variant="secondary">{section}</Badge>)}</div><div className="flex justify-between text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{s.minutes} minutes</span><span>{s.status === "not_started" ? "Not started" : s.status === "completed" ? "Completed" : `Step ${Math.min(s.currentStep + 1, s.totalSteps)} of ${s.totalSteps}`}</span></div><Button className="w-full" disabled={busy} onClick={() => s.status === "not_started" || s.status === "completed" ? void start(s.id) : void loadScenario(s.id)}>{s.status === "not_started" ? "Start simulation" : s.status === "completed" ? "Run again" : "Continue"}</Button></CardContent></Card>)}</div></section>;

  return <div className="space-y-8"><div><h1 className="flex items-center gap-2 text-3xl font-bold"><BookOpenCheck className="h-8 w-8" />Learn</h1><p className="mt-1 max-w-3xl text-muted-foreground">Practice real SCCC IT situations. Fred supplies the diagnostic questions and explains why they matter, but the scenario’s predetermined diagnosis stays hidden until you work the checks and interpret the results.</p></div>
    <Card className="border-blue-200 bg-blue-50/40"><CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6"><div><div className="text-sm text-muted-foreground">Your progress</div><div className="text-2xl font-bold">{list.completed} of {list.total} scenarios complete</div></div><div className="flex items-center gap-2 text-sm"><ShieldCheck className="h-5 w-5 text-blue-600" />Simulation only—no production changes are made.</div></CardContent></Card>
    {renderGroup("desk", "At My Desk", "Learn how to clarify reports, use Hub evidence, communicate with callers, and create an actionable escalation without needing engineering commands.")}
    {renderGroup("onsite", "Onsite", "Learn what to observe physically, what not to change, how to cross-check the Hub, and when to stop and escalate to an engineer.")}
  </div>;
}
