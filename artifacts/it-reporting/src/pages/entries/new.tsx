import { useForm } from "react-hook-form";
import { useLocation, Link } from "wouter";
import { useCreateEntry } from "@workspace/api-client-react";
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
import { format, startOfISOWeek } from "date-fns";

type FormData = {
  entryDate: string;
  category: string;
  title: string;
  description: string;
  ticketCount: string;
  accomplishments: string;
  challenges: string;
  supportNeeded: string;
};

export default function NewEntry() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createMutation = useCreateEntry();

  const today = new Date();
  const weekOf = format(startOfISOWeek(today), "yyyy-MM-dd");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      entryDate: today.toISOString().slice(0, 10),
      category: "helpdesk",
      title: "",
      description: "",
      ticketCount: "",
      accomplishments: "",
      challenges: "",
      supportNeeded: "",
    },
  });

  const category = watch("category");

  const onSubmit = async (data: FormData) => {
    await createMutation.mutateAsync({
      data: {
        category: data.category as any,
        title: data.title,
        description: data.description,
        weekOf,
        entryDate: data.entryDate,
        ticketCount: data.ticketCount ? parseInt(data.ticketCount) : undefined,
        accomplishments: data.accomplishments || undefined,
        challenges: data.challenges || undefined,
        supportNeeded: data.supportNeeded || undefined,
      } as any,
    });
    queryClient.invalidateQueries({ queryKey: ["/api/entries"] });
    setLocation("/entries");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/entries">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">New Log Entry</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="entryDate">Date</Label>
                <Input
                  id="entryDate"
                  type="date"
                  {...register("entryDate", { required: "Date is required" })}
                />
                {errors.entryDate && (
                  <p className="text-xs text-destructive">{errors.entryDate.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(val) => setValue("category", val)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="helpdesk">Help Desk</SelectItem>
                    <SelectItem value="network">Network</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Title / Summary</Label>
              <Input
                id="title"
                placeholder="Brief summary of today's work"
                {...register("title", { required: "Title is required" })}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Work Description</Label>
              <Textarea
                id="description"
                rows={4}
                placeholder="Describe the work completed today..."
                {...register("description", { required: "Description is required" })}
              />
              {errors.description && (
                <p className="text-xs text-destructive">{errors.description.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticketCount">Tickets Resolved</Label>
              <Input
                id="ticketCount"
                type="number"
                min="0"
                placeholder="0"
                {...register("ticketCount")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="accomplishments">Accomplishments</Label>
              <Textarea
                id="accomplishments"
                rows={3}
                placeholder="Key accomplishments..."
                {...register("accomplishments")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="challenges">Challenges</Label>
              <Textarea
                id="challenges"
                rows={3}
                placeholder="Any obstacles or blockers..."
                {...register("challenges")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supportNeeded">Support Needed</Label>
              <Textarea
                id="supportNeeded"
                rows={2}
                placeholder="Any support or resources needed..."
                {...register("supportNeeded")}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1"
              >
                {createMutation.isPending ? "Saving..." : "Save Entry"}
              </Button>
              <Link href="/entries">
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
