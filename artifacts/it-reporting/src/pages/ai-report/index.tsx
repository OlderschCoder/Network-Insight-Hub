import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Sparkles, Send, Copy, Download } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, "/");

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function StatusReportTab() {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const nineMonthsAgo = (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 9);
    return d.toISOString().slice(0, 10);
  })();

  const [form, setForm] = useState({
    startDate: nineMonthsAgo,
    endDate: today,
    accountName: "Seward County Community College",
    stakeholders: "Maddie Day, CFO / Brad Bennett, President",
    accountStatus: "Active – In Good Standing",
    oculusPM: "Matt Song",
    oculusITO: "Dr. Mark Bojeun",
    revenue: "$760,440",
    profitability: "35% gross margin / 5% net margin",
    contractValid: "July 1, 2027",
    additionalNotes: "",
  });

  const [report, setReport] = useState<string>("");
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setReport("");
    try {
      const res = await fetch(`${API_BASE}/status-report/generate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data.report ?? "");
      setSummary(data.dataSummary);
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(report);
    toast({ title: "Copied to clipboard" });
  };

  const handleDownload = () => {
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Seward_Status_${form.endDate}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Report Inputs</CardTitle>
          <CardDescription>
            Operational data is auto-pulled from the platform. Fill in the executive fields below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Period Start</Label>
              <Input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div>
              <Label>Period End</Label>
              <Input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Account Name</Label>
            <Input
              value={form.accountName}
              onChange={(e) => setForm({ ...form, accountName: e.target.value })}
            />
          </div>
          <div>
            <Label>Client / Stakeholders</Label>
            <Input
              value={form.stakeholders}
              onChange={(e) => setForm({ ...form, stakeholders: e.target.value })}
            />
          </div>
          <div>
            <Label>Account Status</Label>
            <Input
              value={form.accountStatus}
              onChange={(e) => setForm({ ...form, accountStatus: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>OculusIT PM</Label>
              <Input
                value={form.oculusPM}
                onChange={(e) => setForm({ ...form, oculusPM: e.target.value })}
              />
            </div>
            <div>
              <Label>OculusIT ITO</Label>
              <Input
                value={form.oculusITO}
                onChange={(e) => setForm({ ...form, oculusITO: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Revenue</Label>
              <Input
                value={form.revenue}
                onChange={(e) => setForm({ ...form, revenue: e.target.value })}
              />
            </div>
            <div>
              <Label>Profitability</Label>
              <Input
                value={form.profitability}
                onChange={(e) => setForm({ ...form, profitability: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Contract Valid Until</Label>
            <Input
              value={form.contractValid}
              onChange={(e) => setForm({ ...form, contractValid: e.target.value })}
            />
          </div>
          <div>
            <Label>Additional Notes (optional context for AI)</Label>
            <Textarea
              rows={3}
              value={form.additionalNotes}
              onChange={(e) => setForm({ ...form, additionalNotes: e.target.value })}
              placeholder="Anything specific you want the report to emphasize..."
            />
          </div>
          <Button onClick={handleGenerate} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating (this may take 30-60s)...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Status Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Generated Report</CardTitle>
            {summary && (
              <CardDescription className="mt-1">
                Pulled {summary.entriesCount} entries · {summary.weeklyReportsCount} weekly reports ·{" "}
                {summary.openRisksCount} open risks · {summary.aarCount} after-action reports ·{" "}
                {summary.totalTickets} tickets
              </CardDescription>
            )}
          </div>
          {report && (
            <div className="flex gap-2 shrink-0">
              <Button variant="ghost" size="icon" onClick={handleCopy} title="Copy">
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleDownload} title="Download">
                <Download className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {report ? (
            <Textarea
              value={report}
              onChange={(e) => setReport(e.target.value)}
              rows={28}
              className="font-mono text-sm"
            />
          ) : (
            <div className="border-2 border-dashed border-border rounded-md py-16 text-center text-muted-foreground">
              Configure the inputs and click Generate. The AI will read your operational data and
              produce an executive status report.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChatTab() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lookbackDays, setLookbackDays] = useState(90);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/status-report/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ messages: newMessages, lookbackDays }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMessages([...newMessages, { role: "assistant", content: data.reply ?? "" }]);
    } catch (e: any) {
      toast({ title: "Chat failed", description: e.message, variant: "destructive" });
      setMessages(newMessages);
    } finally {
      setLoading(false);
    }
  };

  const examples = [
    "Summarize the top 3 risks right now.",
    "Draft a 'Recent Wins' section for an executive report.",
    "What's our biggest network challenge in the last 90 days?",
    "Which incidents are still open in the after-action reports?",
  ];

  return (
    <Card className="h-[calc(100vh-220px)] flex flex-col">
      <CardHeader className="border-b shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Ask the IT Data</CardTitle>
            <CardDescription>
              The AI has read access to entries, risks, after-action reports, and network inventory.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Lookback days:</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20 h-8"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-3 py-6">
            <p className="text-sm text-center text-muted-foreground">
              Start by asking a question, or try one of these:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {examples.map((q) => (
                <Badge
                  key={q}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent py-2 px-3 font-normal"
                  onClick={() => setInput(q)}
                >
                  {q}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
              Thinking...
            </div>
          </div>
        )}
      </CardContent>
      <div className="border-t p-3 shrink-0">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about entries, risks, AARs, network inventory..."
            rows={2}
            className="resize-none"
            disabled={loading}
          />
          <Button onClick={handleSend} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function AIReport() {
  const { isCIO } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-7 w-7" />
          AI Reporting Assistant
        </h1>
        <p className="text-muted-foreground mt-1">
          Generate executive reports and ask questions about your IT department data.
        </p>
      </div>

      <Tabs defaultValue={isCIO ? "status" : "chat"}>
        <TabsList>
          {isCIO && <TabsTrigger value="status">Status Report</TabsTrigger>}
          <TabsTrigger value="chat">Ask AI</TabsTrigger>
        </TabsList>
        {isCIO && (
          <TabsContent value="status" className="mt-6">
            <StatusReportTab />
          </TabsContent>
        )}
        <TabsContent value="chat" className="mt-6">
          <ChatTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
