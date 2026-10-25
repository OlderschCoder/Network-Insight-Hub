import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Network, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/authFetch";

const API = import.meta.env.VITE_API_URL || "/api";

type SwitchFacts = {
  ip: string;
  hostname: string;
  platform: string;
  vendor?: string | null;
  model?: string | null;
  models: string[];
  serialNumbers: string[];
  osVersion?: string | null;
  interfaceCount: number;
  physicalInterfaceCount: number;
  lldpNeighborCount: number;
  macTablePortCount: number;
  warnings: string[];
};

type Preview = {
  generatedAt: string;
  facts: SwitchFacts;
  existingInventory: Record<string, string> | null;
  telegrafConfigured: boolean;
  configurationRequired: boolean;
};

function responseMessage(payload: any, fallback: string) {
  return typeof payload?.error === "string" ? payload.error : fallback;
}

function isPrivateIpv4(value: string) {
  const octets = value.trim().split(".");
  if (octets.length !== 4 || octets.some((item) => !/^\d{1,3}$/.test(item) || Number(item) > 255)) return false;
  const [first, second] = octets.map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

export function SwitchEnrollmentTool({ canApply }: { canApply: boolean }) {
  const [ip, setIp] = useState("");
  const [building, setBuilding] = useState("");
  const [location, setLocation] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"preview" | "apply" | null>(null);

  const normalizedIp = ip.trim();
  const expectedConfirmation = `ENROLL ${normalizedIp}`;
  const canEnroll = useMemo(() => canApply
    && !!preview
    && preview.facts.ip === normalizedIp
    && !!building.trim()
    && confirmation === expectedConfirmation
    && !working, [building, canApply, confirmation, expectedConfirmation, normalizedIp, preview, working]);

  const discover = async () => {
    if (!isPrivateIpv4(normalizedIp)) {
      setError("Enter a private campus IPv4 management address.");
      return;
    }
    setWorking("preview");
    setError("");
    setPreview(null);
    setResult(null);
    setConfirmation("");
    try {
      const response = await authFetch(`${API}/network/switch-enrollment/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: normalizedIp }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, `Switch discovery failed (${response.status}).`));
      setPreview(payload as Preview);
      setLocation((current) => current || payload?.existingInventory?.location || "");
      setBuilding((current) => current || payload?.existingInventory?.site || payload?.existingInventory?.building || "");
    } catch (caught: any) {
      setError(caught?.message || "Switch discovery failed.");
    } finally {
      setWorking(null);
    }
  };

  const enroll = async () => {
    if (!canEnroll) return;
    setWorking("apply");
    setError("");
    setResult(null);
    try {
      const response = await authFetch(`${API}/network/switch-enrollment/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip: normalizedIp,
          building: building.trim(),
          location: location.trim() || building.trim(),
          confirm: confirmation,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(payload, `Switch enrollment failed (${response.status}).`));
      setResult(payload);
    } catch (caught: any) {
      setError(caught?.message || "Switch enrollment failed.");
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Network className="h-5 w-5" /> Add a managed switch</CardTitle>
          <CardDescription>
            Enter the management IP. Fred discovers the switch first; credentials remain on the collector at 10.0.0.22.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="switch-ip">Switch management IPv4 address</Label>
              <Input id="switch-ip" inputMode="numeric" placeholder="192.168.2.220" value={ip}
                onChange={(event) => { setIp(event.target.value); setPreview(null); setResult(null); }} disabled={!!working} />
            </div>
            <Button type="button" onClick={() => void discover()} disabled={!!working || !isPrivateIpv4(normalizedIp)}>
              {working === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Discover switch
            </Button>
          </div>

          {error && (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          {preview && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{preview.facts.hostname}</div>
                  <div className="text-sm text-muted-foreground">{preview.facts.ip}</div>
                </div>
                <Badge variant={preview.telegrafConfigured ? "secondary" : "outline"}>
                  {preview.telegrafConfigured ? "Already in Telegraf" : "Ready to add"}
                </Badge>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-muted-foreground">Vendor / model</dt><dd>{preview.facts.vendor || "Unknown"} {preview.facts.model || ""}</dd></div>
                <div><dt className="text-muted-foreground">Platform</dt><dd>{preview.facts.platform}</dd></div>
                <div><dt className="text-muted-foreground">Software</dt><dd>{preview.facts.osVersion || "Unknown"}</dd></div>
                <div><dt className="text-muted-foreground">Serial</dt><dd>{preview.facts.serialNumbers.join(", ") || "Unknown"}</dd></div>
                <div><dt className="text-muted-foreground">Interfaces</dt><dd>{preview.facts.physicalInterfaceCount} physical / {preview.facts.interfaceCount} total</dd></div>
                <div><dt className="text-muted-foreground">LLDP neighbors</dt><dd>{preview.facts.lldpNeighborCount}</dd></div>
                <div><dt className="text-muted-foreground">MAC-table ports</dt><dd>{preview.facts.macTablePortCount}</dd></div>
                <div><dt className="text-muted-foreground">Inventory</dt><dd>{preview.existingInventory ? "Existing record found" : "New switch"}</dd></div>
              </dl>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1"><Label htmlFor="switch-building">Building</Label><Input id="switch-building" value={building} onChange={(event) => setBuilding(event.target.value)} maxLength={80} disabled={!!working || !canApply} /></div>
                <div className="space-y-1"><Label htmlFor="switch-location">Room / location</Label><Input id="switch-location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={80} disabled={!!working || !canApply} /></div>
              </div>

              {canApply ? (
                <div className="space-y-2 rounded-md bg-muted/50 p-3">
                  <Label htmlFor="switch-confirm">Type <code>{expectedConfirmation}</code> to configure and enroll</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input id="switch-confirm" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={!!working} />
                    <Button type="button" onClick={() => void enroll()} disabled={!canEnroll}>
                      {working === "apply" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Configure and enroll
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">This creates an encrypted backup, applies and saves SNMPv3, updates Telegraf, then verifies fresh Influx data.</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">You can discover switches. Applying configuration requires Network Administrator access.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="flex gap-3 pt-6">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" />
            <div><div className="font-semibold text-emerald-900">{result.facts?.hostname} is enrolled</div><p className="text-sm text-emerald-800">Switch configuration, Telegraf, Influx telemetry, and Fred inventory were verified.</p></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
