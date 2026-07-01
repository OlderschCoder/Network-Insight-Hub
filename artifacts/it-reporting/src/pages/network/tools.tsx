import { useState } from "react";
import {
  useGetNetworkWhitelist,
  useWhitelistWebsite,
  getGetNetworkWhitelistQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ShieldCheck, Globe, Loader2, AlertTriangle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

const actionColor: Record<string, string> = {
  exempt: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  allow: "bg-blue-500/10 text-blue-700 border-blue-200",
  monitor: "bg-amber-500/10 text-amber-700 border-amber-200",
  block: "bg-red-500/10 text-red-700 border-red-200",
};

export default function NetworkTools() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [action, setAction] = useState<"exempt" | "allow" | "monitor">("exempt");

  const { data, isLoading, error } = useGetNetworkWhitelist({
    query: { retry: false } as any,
  });

  const mutation = useWhitelistWebsite({
    mutation: {
      onSuccess: (result: { added: boolean; url: string; tableName: string; action: string }) => {
        toast({
          title: result.added ? "Website whitelisted" : "Already whitelisted",
          description: result.added
            ? `${result.url} added to "${result.tableName}" (${result.action}).`
            : `${result.url} was already present in "${result.tableName}".`,
        });
        setUrl("");
        queryClient.invalidateQueries({ queryKey: getGetNetworkWhitelistQueryKey() });
      },
      onError: (err: any) => {
        toast({
          title: "Whitelist failed",
          description: err?.data?.message ?? err?.message ?? "Could not reach the FortiGate. Try again.",
          variant: "destructive",
        });
      },
    } as any,
  });

  const configured = data?.configured ?? false;
  const entries = data?.entries ?? [];
  // A 502 (FortiGate reachable-but-errored) surfaces as a query error.
  const loadErrorMsg = (error as any)?.data?.message ?? (error ? "Could not read the whitelist from the FortiGate." : null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast({ title: "Enter a URL or domain", variant: "destructive" });
      return;
    }
    mutation.mutate({ data: { url: url.trim(), action } });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div className="space-y-1">
        <Link href="/network" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Network
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ShieldCheck className="h-6 w-6 text-emerald-600" /> Network Tools
        </h1>
        <p className="text-muted-foreground">
          Whitelist a website on the FortiGate web filter so it's exempted for users behind the policy.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5" /> Whitelist a website
          </CardTitle>
          <CardDescription>
            Enter a domain (e.g. <span className="font-mono">example.com</span>) or full URL. Bare domains
            are wrapped as wildcards (<span className="font-mono">*example.com*</span>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isLoading && !configured && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">FortiGate is not configured.</p>
                <p>
                  Set <span className="font-mono">FORTIGATE_HOST</span> and{" "}
                  <span className="font-mono">FORTIGATE_API_TOKEN</span> (optionally{" "}
                  <span className="font-mono">FORTIGATE_VDOM</span> /{" "}
                  <span className="font-mono">FORTIGATE_WEBFILTER_PROFILE</span>) to enable this tool.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="wl-url" className="text-sm font-medium">
                URL or domain
              </label>
              <Input
                id="wl-url"
                placeholder="example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={!configured || mutation.isPending}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Action</label>
              <Select value={action} onValueChange={(v) => setAction(v as any)} disabled={!configured || mutation.isPending}>
                <SelectTrigger className="w-full sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exempt">Exempt</SelectItem>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="monitor">Monitor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!configured || mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Whitelist
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current whitelist</CardTitle>
          <CardDescription>
            {configured && data?.host
              ? `Entries in ${data.profile ?? "the"} web-filter profile on ${data.host}.`
              : "Entries appear here once the FortiGate is configured and reachable."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : loadErrorMsg && configured ? (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadErrorMsg}</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {configured ? "No whitelist entries yet." : "Nothing to show."}
            </p>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => (
                <li key={String(entry.id)} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono text-sm break-all">{entry.url}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className={actionColor[entry.action] ?? ""}>
                      {entry.action}
                    </Badge>
                    {entry.status !== "enable" && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {entry.status}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
