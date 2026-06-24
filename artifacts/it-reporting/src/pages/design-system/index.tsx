import { useState } from "react";
import { Activity, Cloud, FileText, ShieldAlert } from "lucide-react";
import {
  AppShell,
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
  Input,
  Select,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  StatusPill,
  Stat,
  Signature,
} from "@/components/system";

const tokens = [
  { name: "forest", value: "#14361F", className: "bg-forest", text: "text-white" },
  { name: "forest-2", value: "#1B4332", className: "bg-forest-2", text: "text-white" },
  { name: "brand (emerald)", value: "#2FAE6B", className: "bg-brand", text: "text-white" },
  { name: "brand-soft (mint)", value: "#6FD6A6", className: "bg-brand-soft", text: "text-ink" },
  { name: "paper (bg)", value: "#F6F8F7", className: "bg-paper", text: "text-ink" },
  { name: "surface", value: "#FFFFFF", className: "bg-surface", text: "text-ink" },
  { name: "ink (text)", value: "#0B1220", className: "bg-ink", text: "text-white" },
  { name: "ink-muted", value: "#5A6472", className: "bg-ink-muted", text: "text-white" },
  { name: "line (border)", value: "#E5E8EC", className: "bg-line", text: "text-ink" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignSystem() {
  const [selectValue, setSelectValue] = useState("operational");

  return (
    <AppShell>
      <PageHeader
        title="SCCC Design System"
        description="Centralized tokens and reusable primitives shown in isolation. Saints green, clean and operational — emerald only for actions and live status, white cards, tabular numbers on every metric."
        actions={
          <>
            <Button variant="secondary">Secondary</Button>
            <Button variant="primary">Primary action</Button>
          </>
        }
      />

      <Section title="Color tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tokens.map((t) => (
            <div
              key={t.name}
              className={`flex h-24 flex-col justify-end rounded-[10px] border border-line p-3 ${t.className} ${t.text}`}
            >
              <span className="text-xs font-semibold">{t.name}</span>
              <span className="text-[11px] opacity-80">{t.value}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <Card>
          <CardContent className="space-y-3">
            <p className="text-3xl font-semibold tracking-[-0.02em] text-ink">
              Built for Saints.
            </p>
            <p className="text-sm text-ink-muted">
              Inter throughout. Headings are tight (-0.02em) and weight 600.
              Body copy is calm and quiet so the data carries the personality.
            </p>
            <p className="text-2xl font-semibold tabular-nums text-ink">
              31 / 33 switches online
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </Section>

      <Section title="Stats">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Switches online" value="31 / 33" hint="All buildings nominal" icon={<Activity className="h-4 w-4" />} />
          <Stat label="Open risks" value="7" hint="2 high severity" icon={<ShieldAlert className="h-4 w-4" />} />
          <Stat label="Azure VMs" value="14" hint="Across 3 resource groups" icon={<Cloud className="h-4 w-4" />} />
          <Stat label="Reports this month" value="4" hint="1 awaiting finalize" icon={<FileText className="h-4 w-4" />} />
        </div>
      </Section>

      <Section title="Badges & status">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="brand">Operational</Badge>
          <Badge tone="neutral">Infrastructure</Badge>
          <Badge tone="warning">Degraded</Badge>
          <Badge tone="danger">Down</Badge>
          <StatusPill status="live">Live</StatusPill>
          <StatusPill status="neutral">Idle</StatusPill>
          <StatusPill status="warning">Maintenance</StatusPill>
          <StatusPill status="danger">Outage</StatusPill>
        </div>
      </Section>

      <Section title="Inputs & select">
        <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink">Hostname</label>
            <Input placeholder="core-sw-01.sccc.edu" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink">Status</label>
            <Select
              value={selectValue}
              onChange={(e) => setSelectValue(e.target.value)}
            >
              <option value="operational">Operational</option>
              <option value="maintenance">Maintenance</option>
              <option value="down">Down</option>
            </Select>
          </div>
        </div>
      </Section>

      <Section title="Card">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Technology Support</CardTitle>
              <CardDescription>
                Your go-to resource for tech help, tools, and innovation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Badge tone="brand">Advisory</Badge>
                <Badge tone="neutral">Speaking</Badge>
              </div>
            </CardContent>
            <CardFooter className="gap-2">
              <Button variant="primary">Get support</Button>
              <Button variant="ghost">Browse services</Button>
            </CardFooter>
          </Card>
          <Card>
            <CardContent className="space-y-2">
              <StatusPill status="live">Operational</StatusPill>
              <div className="text-4xl font-semibold tabular-nums tracking-[-0.02em] text-ink">
                31 / 33
              </div>
              <p className="text-sm text-ink-muted">
                Switches online · all systems nominal.
              </p>
              <Signature className="pt-2" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hostname</TableHead>
              <TableHead>Building</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ports</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              { host: "core-sw-01", bldg: "Hobble Hall", status: "live" as const, ports: 48 },
              { host: "dist-sw-03", bldg: "Library", status: "warning" as const, ports: 24 },
              { host: "edge-sw-12", bldg: "Student Union", status: "live" as const, ports: 48 },
            ].map((r) => (
              <TableRow key={r.host}>
                <TableCell className="font-medium">{r.host}</TableCell>
                <TableCell className="text-ink-muted">{r.bldg}</TableCell>
                <TableCell>
                  <StatusPill status={r.status}>
                    {r.status === "live" ? "Online" : "Maintenance"}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.ports}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </AppShell>
  );
}
