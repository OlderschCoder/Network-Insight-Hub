import { useForm } from "react-hook-form";
import { useLocation, Link } from "wouter";
import { useCreateAfterActionReport } from "@workspace/api-client-react";
import type { CreateAfterActionBody } from "@workspace/api-client-react";
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

type FormData = {
  title: string;
  incidentDate: string;
  outcome: string;
  summary: string;
  timeline: string;
  whatWentWell: string;
  whatWentPoorly: string;
  actionItems: string;
};

export default function NewAfterAction() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createMutation = useCreateAfterActionReport();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      title: "",
      incidentDate: new Date().toISOString().slice(0, 10),
      outcome: "success",
      summary: "",
      timeline: "",
      whatWentWell: "",
      whatWentPoorly: "",
      actionItems: "",
    },
  });

  const outcome = watch("outcome");

  const onSubmit = async (data: FormData) => {
    const body = {
      title: data.title,
      incidentDate: data.incidentDate,
      outcome: data.outcome as any,
      summary: data.summary || undefined,
      timeline: data.timeline || undefined,
      whatWentWell: data.whatWentWell || undefined,
      whatWentPoorly: data.whatWentPoorly || undefined,
      actionItems: data.actionItems || undefined,
    } as unknown as CreateAfterActionBody;
    await createMutation.mutateAsync({ data: body as any });
    queryClient.invalidateQueries({ queryKey: ["/api/after-action"] });
    setLocation("/after-action");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/after-action">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">New After-Action Report</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Title / Incident Name</Label>
              <Input
                id="title"
                placeholder="e.g. Network Outage - Main Campus"
                {...register("title", { required: "Title is required" })}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="incidentDate">Incident Date</Label>
                <Input
                  id="incidentDate"
                  type="date"
                  {...register("incidentDate", { required: true })}
                />
              </div>
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select value={outcome} onValueChange={(val) => setValue("outcome", val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="failure">Failure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="summary">Executive Summary</Label>
              <Textarea
                id="summary"
                rows={3}
                placeholder="Brief overview of what happened..."
                {...register("summary")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="timeline">Timeline</Label>
              <Textarea
                id="timeline"
                rows={4}
                placeholder="Chronological sequence of events..."
                {...register("timeline")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatWentWell">What Went Well</Label>
              <Textarea
                id="whatWentWell"
                rows={3}
                placeholder="Positive outcomes and effective responses..."
                {...register("whatWentWell")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatWentPoorly">What Went Poorly</Label>
              <Textarea
                id="whatWentPoorly"
                rows={3}
                placeholder="Areas that need improvement..."
                {...register("whatWentPoorly")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="actionItems">Action Items</Label>
              <Textarea
                id="actionItems"
                rows={3}
                placeholder="Follow-up tasks and assignments..."
                {...register("actionItems")}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1"
              >
                {createMutation.isPending ? "Saving..." : "Save Report"}
              </Button>
              <Link href="/after-action">
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
