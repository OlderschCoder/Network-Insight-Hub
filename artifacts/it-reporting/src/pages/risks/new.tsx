import { useForm } from "react-hook-form";
import { useLocation, Link } from "wouter";
import { useCreateRisk } from "@workspace/api-client-react";
import type { CreateRiskBody } from "@workspace/api-client-react";
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
  type: string;
  severity: string;
  description: string;
  mitigation: string;
};

export default function NewRisk() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createMutation = useCreateRisk();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      title: "",
      type: "risk",
      severity: "medium",
      description: "",
      mitigation: "",
    },
  });

  const type = watch("type");
  const severity = watch("severity");

  const onSubmit = async (data: FormData) => {
    const body: CreateRiskBody = {
      title: data.title,
      type: data.type as any,
      severity: data.severity as any,
      description: data.description || undefined,
      mitigation: data.mitigation || undefined,
    };
    await createMutation.mutateAsync({ data: body });
    queryClient.invalidateQueries({ queryKey: ["/api/risks"] });
    setLocation("/risks");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/risks">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">New Risk / Issue / Design</h1>
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
                <Select value={type} onValueChange={(val) => setValue("type", val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="risk">Risk</SelectItem>
                    <SelectItem value="issue">Issue</SelectItem>
                    <SelectItem value="design">Design Suggestion</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={severity} onValueChange={(val) => setValue("severity", val)}>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={4}
                placeholder="Describe the risk, issue, or design suggestion..."
                {...register("description")}
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
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1"
              >
                {createMutation.isPending ? "Saving..." : "Save"}
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
