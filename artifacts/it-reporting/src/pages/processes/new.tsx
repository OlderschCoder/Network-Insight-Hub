import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateProcess } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PROCESS_CATEGORIES } from "./index";

export default function NewProcess() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const createMutation = useCreateProcess();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");

  const submit = async () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const tags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const created: any = await createMutation.mutateAsync({
        data: {
          title: title.trim(),
          category,
          summary: summary.trim() || undefined,
          content,
          tags,
        },
      });
      qc.invalidateQueries({ queryKey: ["/api/processes"] });
      toast({ title: "Process created" });
      setLocation(`/processes/${created.id}`);
    } catch (e: any) {
      toast({ title: "Could not create", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/processes">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">New Process</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Offboard a departing employee"
            />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROCESS_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tags (comma separated)</Label>
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="m365, ad, ticket"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Summary</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-line description of what this process is for."
              rows={2}
            />
          </div>
          <div>
            <Label className="text-xs">Steps / Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`1. Step one\n2. Step two\n   - sub-detail\n3. Step three`}
              rows={14}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Plain text. Use line breaks and indentation; numbering is up to you.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 justify-end">
        <Link href="/processes"><Button variant="outline">Cancel</Button></Link>
        <Button onClick={submit} disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating…" : "Create Process"}
        </Button>
      </div>
    </div>
  );
}
