import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, GraduationCap, Loader2, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authFetch } from "@/lib/authFetch";

const LIVE_REPORT_URL =
  "https://app-server2.centralus.cloudapp.azure.com:8443/admin/eup-provisioning";

type BannerDocuments = {
  report: string;
  procedure: string;
  changes: string;
  architecture: {
    content: string;
    diagrams: ArchitectureDiagram[];
  };
};

type ArchitectureNodeKind = "source" | "process" | "identity" | "store" | "control" | "external" | "interface";

type ArchitectureDiagram = {
  id: string;
  title: string;
  height: number;
  nodes: Array<{
    id: string;
    label: string;
    subtitle?: string;
    kind: ArchitectureNodeKind;
    x: number;
    y: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
  }>;
};

const architectureKinds = new Set<ArchitectureNodeKind>([
  "source", "process", "identity", "store", "control", "external", "interface",
]);

function isArchitectureDiagram(value: unknown): value is ArchitectureDiagram {
  if (!value || typeof value !== "object") return false;
  const diagram = value as ArchitectureDiagram;
  return typeof diagram.id === "string"
    && typeof diagram.title === "string"
    && Number.isFinite(diagram.height)
    && Array.isArray(diagram.nodes)
    && diagram.nodes.length > 0
    && diagram.nodes.every((node) =>
      typeof node?.id === "string"
      && typeof node?.label === "string"
      && (node.subtitle === undefined || typeof node.subtitle === "string")
      && architectureKinds.has(node.kind)
      && Number.isFinite(node.x)
      && Number.isFinite(node.y))
    && Array.isArray(diagram.edges)
    && diagram.edges.every((edge) =>
      typeof edge?.id === "string"
      && typeof edge?.source === "string"
      && typeof edge?.target === "string"
      && (edge.label === undefined || typeof edge.label === "string"));
}

async function loadBannerDocuments(): Promise<BannerDocuments> {
  const response = await authFetch("/api/banner/documents", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Protected Banner documents could not be loaded (${response.status})`);
  }
  const payload = await response.json();
  if (
    typeof payload?.report !== "string"
    || typeof payload?.procedure !== "string"
    || typeof payload?.changes !== "string"
    || typeof payload?.architecture?.content !== "string"
    || !Array.isArray(payload?.architecture?.diagrams)
    || !payload.architecture.diagrams.every(isArchitectureDiagram)
  ) {
    throw new Error("Protected Banner documents returned an invalid response");
  }
  return payload;
}

const nodeKindStyles: Record<ArchitectureNodeKind, string> = {
  source: "border-blue-500/70 bg-blue-500/10 text-blue-950 dark:text-blue-50",
  process: "border-indigo-500/70 bg-indigo-500/10 text-indigo-950 dark:text-indigo-50",
  identity: "border-emerald-500/70 bg-emerald-500/10 text-emerald-950 dark:text-emerald-50",
  store: "border-amber-500/70 bg-amber-500/10 text-amber-950 dark:text-amber-50",
  control: "border-rose-500/70 bg-rose-500/10 text-rose-950 dark:text-rose-50",
  external: "border-cyan-500/70 bg-cyan-500/10 text-cyan-950 dark:text-cyan-50",
  interface: "border-violet-500/70 bg-violet-500/10 text-violet-950 dark:text-violet-50",
};

function ArchitectureDiagramView({ diagram }: { diagram: ArchitectureDiagram }) {
  const nodes: Node[] = diagram.nodes.map((node) => ({
    id: node.id,
    position: { x: node.x, y: node.y },
    data: {
      label: (
        <div className="space-y-1 text-left">
          <div className="font-semibold leading-tight">{node.label}</div>
          {node.subtitle ? <div className="text-[11px] leading-snug opacity-80">{node.subtitle}</div> : null}
        </div>
      ),
    },
    style: { width: 240, minHeight: 72 },
    className: `w-60 rounded-lg border-2 px-3 py-2 shadow-sm ${nodeKindStyles[node.kind]}`,
  }));

  const edges: Edge[] = diagram.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeWidth: 1.5 },
    labelStyle: { fontSize: 11, fontWeight: 600 },
    labelBgPadding: [5, 3],
    labelBgBorderRadius: 4,
  }));

  return (
    <section className="space-y-2" aria-labelledby={`architecture-${diagram.id}`}>
      <h3 id={`architecture-${diagram.id}`} className="text-lg font-semibold">{diagram.title}</h3>
      <div
        className="overflow-hidden rounded-lg border border-border bg-background"
        style={{ height: Math.min(1_200, Math.max(320, diagram.height)) }}
        role="img"
        aria-label={diagram.title}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          minZoom={0.25}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}

function ArchitecturePanel({ content, diagrams }: BannerDocuments["architecture"]) {
  return (
    <div className="space-y-6">
      <div className="space-y-8 rounded-lg border border-border bg-card p-4 md:p-6">
        {diagrams.map((diagram) => <ArchitectureDiagramView key={diagram.id} diagram={diagram} />)}
      </div>
      <DocumentPanel content={content} />
    </div>
  );
}

function DocumentPanel({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 md:p-8">
      <article className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-a:text-primary prose-table:block prose-table:overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </div>
  );
}

export default function Banner() {
  const { data: documents, error, isPending } = useQuery({
    queryKey: ["protected-banner-documents"],
    queryFn: loadBannerDocuments,
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <GraduationCap className="h-7 w-7" />
            Banner
          </h1>
          <p className="mt-1 text-muted-foreground">
            Student provisioning status, operating guidance, architecture, access, and complete change history.
          </p>
        </div>
        <Button asChild>
          <a href={LIVE_REPORT_URL} target="_blank" rel="noreferrer">
            Open live EUP report
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>

      <div className="flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="text-sm">
          <p className="font-semibold">Production EUP create and update are enabled.</p>
          <p className="text-muted-foreground">
            The expanded accepted-student verification completed 251 of 251 Banner identity, Third Party ID, and preferred GOAEMAL checks at the latest August 20 checkpoint. Entra remains the required Google gate, and the Production worker and guarded reconcilers continue automatically.
          </p>
        </div>
      </div>

      {isPending ? (
        <div className="flex min-h-56 items-center justify-center rounded-lg border border-border bg-card">
          <div className="flex items-center gap-3 text-muted-foreground" role="status">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading protected Banner documentation…
          </div>
        </div>
      ) : error || !documents ? (
        <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">Banner documentation is unavailable.</p>
            <p className="text-muted-foreground">{error instanceof Error ? error.message : "Please sign in again or contact IT."}</p>
          </div>
        </div>
      ) : (
        <Tabs defaultValue="report" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-4">
            <TabsTrigger value="report">Corrected Report</TabsTrigger>
            <TabsTrigger value="procedure">Operating Procedure</TabsTrigger>
            <TabsTrigger value="changes">Full Change Log</TabsTrigger>
            <TabsTrigger value="architecture">System Architecture &amp; Access</TabsTrigger>
          </TabsList>
          <TabsContent value="report"><DocumentPanel content={documents.report} /></TabsContent>
          <TabsContent value="procedure"><DocumentPanel content={documents.procedure} /></TabsContent>
          <TabsContent value="changes"><DocumentPanel content={documents.changes} /></TabsContent>
          <TabsContent value="architecture">
            <ArchitecturePanel content={documents.architecture.content} diagrams={documents.architecture.diagrams} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
