import { useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, Link } from "wouter";
import {
  useCreateRisk,
  useUpdateRisk,
  type CreateRiskBody,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

export const RISK_CATEGORIES: { value: string; label: string }[] = [
  { value: "network", label: "Network" },
  { value: "internet", label: "Internet" },
  { value: "banner", label: "Banner" },
  { value: "canvas", label: "Canvas" },
  { value: "projects", label: "Projects" },
  { value: "uptime", label: "Up-time" },
  { value: "security", label: "Security" },
  { value: "vendor", label: "Vendor" },
  { value: "facilities", label: "Facilities" },
  { value: "other", label: "Other" },
];

type FormData = {
  title: string;
  type: string;
  severity: string;
  probability: string;
  category: string;
  status: string;
  description: string;
  mitigation: string;
  impact: string;
};

type Props = { mode: "new" | "edit"; risk?: any };

export default function RiskForm({ mode, risk }: Props) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const createMutation = useCreateRisk();
  const updateMutation = useUpdateRisk();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      title: risk?.title || "",
      type: risk?.type || "risk",
      severity: risk?.severity || "medium",
      probability: risk?.probability || "medium",
      category: risk?.category || "other",
      status: risk?.status || "open",
      description: risk?.description || "",
      mitigation: risk?.mitigation || "",
      impact: risk?.impact || "",
    },
  });

  const type = watch("type");
  const severity = watch("severity");
  const probability = watch("probability");
  const category = watch("category");
  const status = watch("status");

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    try {
      if (mode === "edit" && risk?.id) {
        await updateMutation.mutateAsync({
          id: risk.id,
          data: {
            title: data.title,
            type: data.type as any,
            severity: data.severity as any,
            probability: data.probability as any,
            category: data.category,
            status: data.status as any,
            description: data.description,
            mitigation: data.mitigation || undefined,
            impact: data.impact || undefined,
          },
        });
      } else {
        const body: CreateRiskBody = {
          title: data.title,
          type: data.type as any,
          severity: data.severity as any,
          probability: data.probability as any,
          category: data.category,
          description: data.description,
          mitigation: data.mitigation || undefined,
          impact: data.impact || undefined,
        };
        await createMutation.mutateAsync({ data: body });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/risks"] });
      setLocation("/risks");
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const backHref = mode === "edit" ? `/risks` : "/risks";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">
          {mode === "edit" ? "Edit Risk / Issue" : "New Risk / Issue / Design"}
        </h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Brief title describing the item"
                {...register("title", { required: "Title is required" })}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => setValue("type", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="risk">Risk</SelectItem>
                    <SelectItem value="issue">Issue</SelectItem>
                    <SelectItem value="suggestion">Design Suggestion</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setValue("category", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RISK_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className={mode === "edit" ? "grid grid-cols-3 gap-4" : "grid grid-cols-2 gap-4"}>
              <div className="space-y-2">
                <Label>Severity (impact)</Label>
                <Select value={severity} onValueChange={(v) => setValue("severity", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Probability</Label>
                <Select
                  value={probability}
                  onValueChange={(v) => setValue("probability", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Almost certain</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mode === "edit" && (
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={status} onValueChange={(v) => setValue("status", v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="mitigated">Mitigated</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={4}
                placeholder="Describe the risk, issue, or design suggestion..."
                {...register("description", { required: "Description is required" })}
              />
              {errors.description && (
                <p className="text-xs text-destructive">{errors.description.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="impact">Impact (optional)</Label>
              <Textarea
                id="impact"
                rows={2}
                placeholder="What's the impact if this happens / continues?"
                {...register("impact")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mitigation">Mitigation / Next Steps</Label>
              <Textarea
                id="mitigation"
                rows={3}
                placeholder="Proposed mitigation or action items..."
                {...register("mitigation")}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting
                  ? "Saving..."
                  : mode === "edit"
                  ? "Save Changes"
                  : "Save"}
              </Button>
              <Link href="/risks">
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
