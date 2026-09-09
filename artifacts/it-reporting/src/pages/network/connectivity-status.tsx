import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Cloud,
  Copy,
  RadioTower,
  Route,
  Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type IndicatorTone = "healthy" | "blocked" | "unknown" | "degraded";

type ConnectivityIndicator = {
  name: string;
  status: string;
  tone: IndicatorTone;
  summary: string;
  evidence: string;
  icon: typeof Wifi;
};

const snapshot = {
  observedAt: "September 4, 2026 at 8:53 PM Central",
  source: "Live tests across the production-active Main and West FortiGates",
  westAccess: "West FortiGate available through the approved Azure jump host",
};

const indicators: ConnectivityIndicator[] = [
  {
    name: "SCCC Wireless",
    status: "Connected on Main",
    tone: "healthy",
    summary: "Main owns 10.11.16.0/20 on ARUBA-BYOD-202.",
    evidence: "The active firewall selected this as the best connected route. This is the known-good comparison for wireless routing on Main.",
    icon: Wifi,
  },
  {
    name: "West Wireless",
    status: "Address conflict",
    tone: "blocked",
    summary: "West is defined as 10.11.16.0/24, inside Main's 10.11.16.0/20.",
    evidence: "The overlapping networks cannot be conventionally routed across the tunnel. West must be renumbered or represented by translated VPN addresses.",
    icon: RadioTower,
  },
  {
    name: "Azure to Main",
    status: "Needs live check",
    tone: "unknown",
    summary: "The Azure-SCCC2 configuration and policies exist.",
    evidence: "The capture did not include live IKE or tunnel diagnostics for Azure-SCCC2, so its current end-to-end data-path state is still unknown.",
    icon: Cloud,
  },
  {
    name: "Azure to West",
    status: "Endpoint verified",
    tone: "healthy",
    summary: "This path depends on Azure-SCCC2, Main, and West_FGT.",
    evidence: "An SSH connection from an Azure host to the West FortiGate completed successfully. This live endpoint test supersedes the earlier counter-only one-way indication.",
    icon: Route,
  },
  {
    name: "West wired to Main",
    status: "Path verified",
    tone: "healthy",
    summary: "West wired traffic crossed the tunnel to Main switch management.",
    evidence: "Sourced tests reached 192.168.2.175 and 192.168.2.200 with no packet loss. Main observed tunnel ingress, port3 egress, replies, and tunnel return. Only 192.168.2.176 did not answer.",
    icon: Route,
  },
  {
    name: "West wired to Azure",
    status: "TCP/22 verified",
    tone: "healthy",
    summary: "West policy 12 now includes the existing Azure 10.0.0.0/25 object.",
    evidence: "A West wired client successfully reached TCP port 22 on 10.0.0.44. Main's West_All group includes West_Wired and West_Wireless.",
    icon: Cloud,
  },
];

const toneClass: Record<IndicatorTone, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  blocked: "border-red-200 bg-red-50 text-red-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-700",
  degraded: "border-amber-200 bg-amber-50 text-amber-800",
};

const telemetryCommands = `get system status
get system ha status
get system performance status
get system interface
get router info routing-table all
get router info routing-table details 10.11.16.10
get router info routing-table details 10.90.0.10
get router info routing-table details 172.25.0.10
get router info routing-table details 192.168.2.176
get router info routing-table details 10.0.0.32
get vpn ipsec tunnel summary`;

const configurationCommands = `show system interface
show router static
show vpn ipsec phase2-interface
show firewall address
show firewall addrgrp
show firewall policy`;

type CommandBlockProps = {
  commands: string;
  description: string;
  title: string;
};

function CommandBlock({ commands, description, title }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyCommands() {
    await navigator.clipboard.writeText(commands);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={copyCommands} className="shrink-0">
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-50">
        <code>{commands}</code>
      </pre>
    </div>
  );
}

export function ConnectivityStatusTool() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Route className="h-5 w-5" /> Connectivity evidence
          </CardTitle>
          <CardDescription>
            A durable, time-stamped comparison of remote VPN, Main, West wired, West wireless, and Azure paths.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Production-active firewall identified; HA redundancy remains degraded.</p>
              <p className="mt-1">
                This member had 28,277 sessions, active monitored data interfaces, and active routes. It still reported
                its HA peer lost and the heartbeat down. Make no failover, synchronization, reset, reboot, or heartbeat changes.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Observed: {snapshot.observedAt}</Badge>
            <Badge variant="outline">Source: {snapshot.source}</Badge>
            <Badge variant="outline">{snapshot.westAccess}</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {indicators.map((indicator) => {
              const Icon = indicator.icon;
              return (
                <Card key={indicator.name} className="shadow-none">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Icon className="h-4 w-4" /> {indicator.name}
                      </CardTitle>
                      <Badge variant="outline" className={toneClass[indicator.tone]}>{indicator.status}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="font-medium">{indicator.summary}</p>
                    <p className="text-muted-foreground">{indicator.evidence}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Safe Fred collection commands</CardTitle>
          <CardDescription>
            Run these only on the production-active FortiGate, then save each output with the firewall hostname and collection time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
            <Check className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              Every command below is read-only. It does not enter configuration mode, change HA, reset a tunnel,
              synchronize a peer, reboot a unit, or modify an interface.
            </p>
          </div>

          <CommandBlock
            title="Live telemetry"
            description="Health, interfaces, route decisions for the known comparison addresses, and safe tunnel counters."
            commands={telemetryCommands}
          />
          <CommandBlock
            title="Configuration snapshot"
            description="Read-only show commands for interfaces, routes, selectors, address objects, groups, and policies."
            commands={configurationCommands}
          />

          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
            <p className="font-medium">Do not collect or store in Fred</p>
            <p className="mt-1 text-xs">
              Exclude detailed <code>diagnose vpn</code> listings, phase-one configuration, full configuration exports,
              session dumps, and all commands that reset, clear, synchronize, fail over, reboot, or change HA.
              Detailed VPN listings can reveal live IPsec session keys; phase-one output can reveal protected PSKs.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Path comparison</CardTitle>
          <CardDescription>Why Azure to Main can differ from Azure to West.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
            <Badge variant="secondary">Azure</Badge><ArrowRight className="h-4 w-4" />
            <Badge variant="secondary">Azure-SCCC2</Badge><ArrowRight className="h-4 w-4" />
            <Badge variant="secondary">Main resources</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-3">
            <Badge variant="secondary">Azure</Badge><ArrowRight className="h-4 w-4" />
            <Badge variant="secondary">Azure-SCCC2</Badge><ArrowRight className="h-4 w-4" />
            <Badge variant="secondary">Main</Badge><ArrowRight className="h-4 w-4" />
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">West_FGT up</Badge>
            <ArrowRight className="h-4 w-4" />
            <Badge variant="secondary">West resources</Badge>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">TCP/22 endpoint verified</Badge>
          </div>
          <p className="text-muted-foreground">
            Azure-to-Main success does not prove Azure-to-West health. The West path adds a second tunnel,
            reciprocal selectors and policies, and active routes on both FortiGates.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Evidence still needed</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The intended West Wireless subnet and a current wireless-client test remain necessary. The wired West-to-Main
          and West-to-Azure paths are verified; 192.168.2.176 remains an endpoint-specific failure rather than a tunnel failure.
        </CardContent>
      </Card>
    </div>
  );
}
