import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2, Server, Wifi, WifiOff, AlertTriangle, Activity,
  ArrowLeft, ChevronRight, Loader2, RefreshCw, Search, Pencil, Save, X, PhoneCall, ExternalLink,
} from "lucide-react";

const API = "/api";
const PUBLIC_BUILDINGS_API = `${API}/network/public/buildings`;
const PUBLIC_BUILDINGS_LAYOUT_API = `${API}/network/public/buildings/map-layout`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface BuildingSummary {
  name: string;
  nodeCount: number;
  vlanCount: number;
  healthColor: "green" | "amber" | "red" | "unknown";
  influxConfigured: boolean;
}

interface NetNodeSummary {
  id: string;
  hostname: string;
  displayName: string | null;
  nodeKind: string;
  vendor: string | null;
  model: string | null;
  mgmtIp: string | null;
  location: string | null;
  role: string | null;
  criticality: string | null;
  status: string | null;
  liveStatus: "up" | "degraded" | "down" | "unknown";
}

interface VlanSummary {
  id: number;
  vlanId: number;
  name: string | null;
  description: string | null;
  building: string;
  ipRange: string | null;
  vlanPurpose: string | null;
}

interface BuildingDetail {
  name: string;
  nodes: NetNodeSummary[];
  vlans: VlanSummary[];
  links: any[];
  healthColor: "green" | "amber" | "red" | "unknown";
  influxConfigured: boolean;
}

interface OverlayPosition {
  code: string;
  x: number;
  y: number;
  labelDx?: number | null;
  labelDy?: number | null;
}

interface CampusStatusMapProps {
  buildings: BuildingSummary[];
  publicMode?: boolean;
}

interface CallingSupportSnapshot {
  configured: boolean;
  queryError: string | null;
  links: {
    controlHubOverview: string;
    devicesReference: string;
    serviceAppsGuide: string;
    auditEventsReference: string;
    emergencyCallingGuide: string;
  };
  e911Range: {
    start: number;
    end: number;
    present: number[];
    missing: number[];
  };
  summary: {
    totalWebexDevices: number;
    onlineWebexDevices: number;
    offlineWebexDevices: number;
    unknownWebexDevices: number;
    totalCallingBuildings: number;
    healthyCallingBuildings: number;
    attentionCallingBuildings: number;
    unknownCallingBuildings: number;
  };
  buildings: Array<{
    name: string;
    healthColor: "green" | "amber" | "red" | "gray";
    monitoringStrategy: string;
    nodeCount: number;
    switchCount: number;
    onlineSwitchCount: number;
    offlineSwitchCount: number;
    e911Vlans: Array<{
      id: number;
      vlanId: number;
      name: string;
      description: string | null;
      subnet: string | null;
      gateway: string | null;
    }>;
  }>;
  devices: Array<{
    name: string;
    product: string;
    status: "online" | "offline" | "unknown";
  }>;
}

export type CampusMapBuildingHealth = {
  name: string;
  healthColor: "green" | "amber" | "red" | "unknown";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const healthStyles: Record<string, { bg: string; border: string; ring: string; label: string; icon: ReactNode }> = {
  green: {
    bg: "bg-green-50 hover:bg-green-100",
    border: "border-green-400",
    ring: "ring-green-300",
    label: "All systems up",
    icon: <Wifi className="h-5 w-5 text-green-600" />,
  },
  amber: {
    bg: "bg-amber-50 hover:bg-amber-100",
    border: "border-amber-400",
    ring: "ring-amber-300",
    label: "Degraded",
    icon: <AlertTriangle className="h-5 w-5 text-amber-500" />,
  },
  red: {
    bg: "bg-red-50 hover:bg-red-100",
    border: "border-red-400",
    ring: "ring-red-300",
    label: "One or more devices down",
    icon: <WifiOff className="h-5 w-5 text-red-600" />,
  },
  unknown: {
    bg: "bg-gray-50 hover:bg-gray-100",
    border: "border-gray-300",
    ring: "ring-gray-200",
    label: "Status unknown",
    icon: <Activity className="h-5 w-5 text-gray-400" />,
  },
};

type CampusOverlay = {
  code: string;
  buildingName: string;
  preferredNames?: string[];
  aliases: string[];
  x: number;
  y: number;
  labelDx?: number;
  labelDy?: number;
  labelGroup?: string;
  labelAnchor?: boolean;
  displayCode?: string;
  compactMarker?: boolean;
};

const CAMPUS_OVERLAYS: CampusOverlay[] = [
  { code: "WEST", buildingName: "West Campus", preferredNames: ["West Campus"], aliases: ["west campus", "west"], x: 1.0, y: 49.5, labelDx: 18, labelDy: -16 },
  { code: "TA", buildingName: "Tech Building A", preferredNames: ["Tech Building A"], aliases: ["tech building a", "technology a"], x: 30.2, y: 7.5, labelDx: -12, labelDy: -42, compactMarker: true },
  { code: "TB", buildingName: "Tech Building B", preferredNames: ["Tech Building B"], aliases: ["tech building b", "technology b"], x: 34.4, y: 12.5, labelDx: -8, labelDy: 6, compactMarker: true },
  { code: "TD", buildingName: "Tech Building D", preferredNames: ["Tech Building D"], aliases: ["tech building d", "technology d"], x: 55.3, y: 7.0, labelDx: -8, labelDy: -38, compactMarker: true },
  { code: "TT", buildingName: "Tech Building T", preferredNames: ["Tech Building T"], aliases: ["tech building t", "technology t"], x: 58.8, y: 7.0, labelDx: 10, labelDy: -38, compactMarker: true },
  { code: "ITC", buildingName: "Industrial Technology Campus", preferredNames: ["Industrial Technology Campus"], aliases: ["industrial technology campus"], x: 61.5, y: 8.0, labelDx: 12, labelDy: -16, displayCode: "ITC" },
  { code: "V", buildingName: "Agriculture", preferredNames: ["Agriculture", "Agriculture (V201)"], aliases: ["v", "agriculture"], x: 72.8, y: 17.8, labelDx: 8, labelDy: -14 },
  { code: "COS", buildingName: "Cosmetology", preferredNames: ["Cosmetology (COS109)", "Cosmetology"], aliases: ["cos", "cosmetology"], x: 36.5, y: 23.0, labelDx: 8, labelDy: -14 },
  { code: "CAH", buildingName: "Colvin Family Center for Allied Health", preferredNames: ["Allied Health"], aliases: ["cah", "colvin family center for allied health", "allied health"], x: 27.0, y: 37.4, labelDx: 8, labelDy: -10 },
  { code: "AA", buildingName: "Hobble", aliases: ["aa", "hobble", "hobble academic", "hobble academic building"], x: 34.8, y: 49.0, labelDx: 8, labelDy: -10, labelGroup: "hobble", labelAnchor: true, displayCode: "AA/A" },
  { code: "A", buildingName: "Hobble", aliases: ["a", "hobble", "hobble academic", "hobble academic building"], x: 39.2, y: 52.0, labelDx: 8, labelDy: -8, labelGroup: "hobble" },
  { code: "H", buildingName: "Humanities Building", preferredNames: ["Humanities"], aliases: ["h", "humanities", "humanities building"], x: 50.6, y: 60.5, labelDx: 8, labelDy: -10 },
  { code: "SA", buildingName: "Student Union / Activities", preferredNames: ["Student Union / Student Activities"], aliases: ["sa", "student union / student activities", "student union / activities", "student union"], x: 69.0, y: 41.2, labelDx: 10, labelDy: 10, labelGroup: "student-union" },
  { code: "SU", buildingName: "Student Union / Activities", preferredNames: ["Student Union / Student Activities"], aliases: ["su", "student union / student activities", "student union / activities", "student union"], x: 70.8, y: 36.8, labelDx: 10, labelDy: -2, labelGroup: "student-union", labelAnchor: true, displayCode: "SA/SU/SW" },
  { code: "SW", buildingName: "Student Union / Activities", preferredNames: ["Student Union / Student Activities"], aliases: ["sw", "student union / student activities", "student union / activities", "student union"], x: 72.5, y: 32.5, labelDx: 10, labelDy: -14, labelGroup: "student-union" },
  { code: "SHC", buildingName: "Student Health Center", preferredNames: ["Student Health Center"], aliases: ["shc", "student health center"], x: 78.2, y: 24.0, labelDx: 8, labelDy: -10 },
  { code: "SLC", buildingName: "Student Living Center", preferredNames: ["Student Living Center", "Student Living Center (SLC151)"], aliases: ["slc", "student living center"], x: 81.2, y: 31.0, labelDx: 8, labelDy: -10 },
  { code: "SLF", buildingName: "Student Living F", preferredNames: ["Student Living F"], aliases: ["student living f"], x: 16.6, y: 27.8, displayCode: "F", compactMarker: true },
  { code: "SLG", buildingName: "Student Living G", preferredNames: ["Student Living G"], aliases: ["student living g"], x: 20.8, y: 27.8, displayCode: "G", compactMarker: true },
  { code: "SLH", buildingName: "Student Living H", preferredNames: ["Student Living H"], aliases: ["student living h"], x: 23.3, y: 27.8, displayCode: "H", compactMarker: true },
  { code: "SLJ", buildingName: "Student Living J", preferredNames: ["Student Living J"], aliases: ["student living j"], x: 17.8, y: 24.7, displayCode: "J", compactMarker: true },
  { code: "SLR", buildingName: "Student Living R", preferredNames: ["Student Living R"], aliases: ["student living r"], x: 20.1, y: 24.7, displayCode: "R", compactMarker: true },
  { code: "SLS", buildingName: "Student Living S", preferredNames: ["Student Living S"], aliases: ["student living s"], x: 22.4, y: 24.7, displayCode: "S", compactMarker: true },
  { code: "SLT", buildingName: "Student Living T", preferredNames: ["Student Living T"], aliases: ["student living t"], x: 24.7, y: 24.7, displayCode: "T", compactMarker: true },
  { code: "SB", buildingName: "Softball Field", preferredNames: ["Softball Field", "Softball"], aliases: ["softball field", "softball", "french family field"], x: 92.3, y: 18.9, labelDx: -92, labelDy: 4 },
  { code: "BB", buildingName: "Baseball Field", preferredNames: ["Baseball Field"], aliases: ["baseball field", "baseball", "brent gould field"], x: 82.6, y: 62.0, labelDx: 12, labelDy: 8 },
  { code: "SFCC", buildingName: "Sharp Family Champion Center", preferredNames: ["Sharp Champion Center"], aliases: ["sfcc", "sharp family champion center", "sharp champion center"], x: 68.6, y: 83.7, labelDx: 8, labelDy: -8 },
];
const HOBBLE_FIBER_HUB = { x: 36.4, y: 50.2 };
const INTERNET_UPLINK_POINT = { x: -2, y: 50.2 };

function normalizeBuildingName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesAlias(name: string, aliases: string[]): boolean {
  const normalized = normalizeBuildingName(name);
  return aliases.some((alias) => {
    const candidate = normalizeBuildingName(alias);
    if (normalized === candidate) return true;
    if (candidate.length < 4) return false;
    return normalized.includes(candidate);
  });
}

function getVisibleCampusOverlayCodes() {
  const anchors = new Set<string>();
  const groups = new Map<string, string[]>();

  for (const overlay of CAMPUS_OVERLAYS) {
    if (!overlay.labelGroup) {
      anchors.add(overlay.code);
      continue;
    }

    const codes = groups.get(overlay.labelGroup) ?? [];
    codes.push(overlay.code);
    groups.set(overlay.labelGroup, codes);
    if (overlay.labelAnchor) anchors.add(overlay.code);
  }

  for (const codes of groups.values()) {
    if (!codes.some((code) => anchors.has(code))) {
      anchors.add(codes[0]);
    }
  }

  return anchors;
}

export function getCampusMapDisplayEntries<T extends CampusMapBuildingHealth>(buildings: T[]) {
  const byName = new Map(buildings.map((building) => [normalizeBuildingName(building.name), building]));
  const visibleOverlayCodes = getVisibleCampusOverlayCodes();

  return CAMPUS_OVERLAYS
    .filter((overlay) => visibleOverlayCodes.has(overlay.code))
    .map((overlay) => {
      let match = null as T | null;

      for (const preferredName of overlay.preferredNames ?? []) {
        match = byName.get(normalizeBuildingName(preferredName)) ?? null;
        if (match) break;
      }

      if (!match) {
        match = byName.get(normalizeBuildingName(overlay.buildingName)) ?? null;
      }

      if (!match) {
        match = buildings.find((building) => matchesAlias(building.name, overlay.aliases)) ?? null;
      }

      return {
        code: overlay.code,
        buildingName: overlay.buildingName,
        displayCode: overlay.displayCode ?? overlay.code,
        match,
      };
    });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lineColorForHealth(healthColor: BuildingSummary["healthColor"] | undefined): string {
  switch (healthColor) {
    case "green":
      return "#22c55e";
    case "amber":
      return "#f59e0b";
    case "red":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

function LiveBadge({ status }: { status: "up" | "degraded" | "down" | "unknown" }) {
  const cfg = {
    up: { cls: "bg-green-100 text-green-700 border-green-300", icon: <Wifi className="h-3 w-3" /> },
    degraded: { cls: "bg-amber-100 text-amber-700 border-amber-300", icon: <AlertTriangle className="h-3 w-3" /> },
    down: { cls: "bg-red-100 text-red-700 border-red-300", icon: <WifiOff className="h-3 w-3" /> },
    unknown: { cls: "bg-gray-100 text-gray-500 border-gray-300", icon: <Activity className="h-3 w-3" /> },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium ${cfg.cls}`}>
      {cfg.icon} {status}
    </span>
  );
}

function critColor(c: string | null) {
  if (!c) return "bg-gray-100 text-gray-500 border-gray-200";
  return {
    critical: "bg-red-100 text-red-700 border-red-300",
    high: "bg-orange-100 text-orange-700 border-orange-300",
    medium: "bg-amber-100 text-amber-700 border-amber-300",
    low: "bg-green-100 text-green-700 border-green-300",
  }[c] ?? "bg-gray-100 text-gray-500 border-gray-200";
}

const callingHealthBadgeClass: Record<string, string> = {
  green: "bg-green-100 text-green-700 border-green-300",
  amber: "bg-amber-100 text-amber-700 border-amber-300",
  red: "bg-red-100 text-red-700 border-red-300",
  gray: "bg-gray-100 text-gray-600 border-gray-300",
};

const callingHealthLabel: Record<string, string> = {
  green: "Network healthy",
  amber: "Attention needed",
  red: "Likely building issue",
  gray: "No live data",
};

// ─── Grid View ────────────────────────────────────────────────────────────────

export function CampusStatusMap({ buildings, publicMode = false }: CampusStatusMapProps) {
  const { user } = useAuth();
  const canEditMap = !publicMode && !!user;
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ code: string; offsetX: number; offsetY: number } | null>(null);
  const defaultPositions = useMemo<Record<string, OverlayPosition>>(
    () =>
      Object.fromEntries(
        CAMPUS_OVERLAYS.map((overlay) => [
          overlay.code,
          {
            code: overlay.code,
            x: overlay.x,
            y: overlay.y,
            labelDx: overlay.labelDx ?? null,
            labelDy: overlay.labelDy ?? null,
          },
        ]),
      ),
    [],
  );
  const [savedPositions, setSavedPositions] = useState<Record<string, OverlayPosition>>(defaultPositions);
  const [overlayPositions, setOverlayPositions] = useState<Record<string, OverlayPosition>>(defaultPositions);
  const [editMode, setEditMode] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [dirtyLayout, setDirtyLayout] = useState(false);

  const loadLayout = useCallback(async () => {
    try {
      const response = publicMode
        ? await fetch(PUBLIC_BUILDINGS_LAYOUT_API)
        : await authFetch(`${API}/network/buildings/map-layout`, { credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      const rows = (await response.json()) as OverlayPosition[];
      const nextPositions = { ...defaultPositions };
      for (const row of rows) {
        const overlayDefinition = CAMPUS_OVERLAYS.find((overlay) => overlay.code === row.code);
        const isLegacyDormPosition = overlayDefinition?.compactMarker
          && row.code.startsWith("SL")
          && row.code !== "SLC"
          && row.x > 30;
        if (isLegacyDormPosition) continue;
        nextPositions[row.code] = {
          code: row.code,
          x: row.x,
          y: row.y,
          labelDx: row.labelDx ?? nextPositions[row.code]?.labelDx ?? null,
          labelDy: row.labelDy ?? nextPositions[row.code]?.labelDy ?? null,
        };
      }
      setSavedPositions(nextPositions);
      setOverlayPositions(nextPositions);
      setDirtyLayout(false);
    } catch (error: any) {
      setSavedPositions(defaultPositions);
      setOverlayPositions(defaultPositions);
      toast({
        title: "Couldn't load map positions",
        description: error?.message ?? "Using default overlay positions.",
        variant: "destructive",
      });
    }
  }, [defaultPositions, publicMode, toast]);

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      const mapElement = mapRef.current;
      if (!dragState || !mapElement) return;

      const rect = mapElement.getBoundingClientRect();
      const nextX = ((event.clientX - rect.left - dragState.offsetX) / rect.width) * 100;
      const nextY = ((event.clientY - rect.top - dragState.offsetY) / rect.height) * 100;

      setOverlayPositions((current) => ({
        ...current,
        [dragState.code]: {
          ...(current[dragState.code] ?? defaultPositions[dragState.code]),
          code: dragState.code,
          x: clamp(nextX, 0, 100),
          y: clamp(nextY, 0, 100),
        },
      }));
      setDirtyLayout(true);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [defaultPositions]);

  const saveLayout = useCallback(async () => {
    setSavingLayout(true);
    try {
      const response = await authFetch(`${API}/network/buildings/map-layout`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: Object.values(overlayPositions) }),
      });
      if (!response.ok) throw new Error(await response.text());
      setSavedPositions(overlayPositions);
      setDirtyLayout(false);
      setEditMode(false);
      toast({ title: "Campus map saved", description: "Bubble positions were updated for everyone." });
    } catch (error: any) {
      toast({
        title: "Couldn't save map positions",
        description: error?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSavingLayout(false);
    }
  }, [overlayPositions, toast]);

  const cancelEditing = useCallback(() => {
    setOverlayPositions(savedPositions);
    setDirtyLayout(false);
    setEditMode(false);
    dragStateRef.current = null;
  }, [savedPositions]);

  const resetLayout = useCallback(async () => {
    setSavingLayout(true);
    try {
      const response = await authFetch(`${API}/network/buildings/map-layout`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await response.text());
      setSavedPositions(defaultPositions);
      setOverlayPositions(defaultPositions);
      setDirtyLayout(false);
      setEditMode(false);
      toast({ title: "Campus map reset", description: "Overlay positions were restored to the defaults." });
    } catch (error: any) {
      toast({
        title: "Couldn't reset map positions",
        description: error?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSavingLayout(false);
    }
  }, [defaultPositions, toast]);

  const beginDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, code: string) => {
    if (!editMode) return;
    const mapElement = mapRef.current;
    const current = overlayPositions[code] ?? defaultPositions[code];
    if (!mapElement || !current) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = mapElement.getBoundingClientRect();
    const anchorX = rect.left + (current.x / 100) * rect.width;
    const anchorY = rect.top + (current.y / 100) * rect.height;
    dragStateRef.current = {
      code,
      offsetX: event.clientX - anchorX,
      offsetY: event.clientY - anchorY,
    };
  }, [defaultPositions, editMode, overlayPositions]);

  const overlays = useMemo(
    () =>
      CAMPUS_OVERLAYS.map((overlay) => {
        const saved = overlayPositions[overlay.code];
        return {
          ...overlay,
          x: saved?.x ?? overlay.x,
          y: saved?.y ?? overlay.y,
          labelDx: saved?.labelDx ?? overlay.labelDx,
          labelDy: saved?.labelDy ?? overlay.labelDy,
        };
      }),
    [overlayPositions],
  );

  const buildingByCode = useMemo(
    () => new Map(getCampusMapDisplayEntries(buildings).map((entry) => [entry.code, entry.match])),
    [buildings],
  );

  const visibleOverlayCodes = useMemo(() => getVisibleCampusOverlayCodes(), []);

  const visibleOverlays = useMemo(
    () => overlays.filter((overlay) => visibleOverlayCodes.has(overlay.code)),
    [overlays, visibleOverlayCodes],
  );

  const fiberLines = useMemo(
    () =>
      visibleOverlays
        .filter((overlay) => !["AA", "WEST"].includes(overlay.code))
        .map((overlay) => {
          const match = buildingByCode.get(overlay.code);
          return {
            code: overlay.code,
            x: overlay.x,
            y: overlay.y,
            healthColor: match?.healthColor ?? "unknown",
          };
        }),
    [buildingByCode, visibleOverlays],
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Building2 className="h-5 w-5 text-primary" />
              Live Campus Status Map
            </CardTitle>
          </div>
          {canEditMap && (
            <div className="flex items-center gap-2">
              {editMode ? (
                <>
                  <Button variant="outline" size="sm" onClick={cancelEditing} disabled={savingLayout} className="gap-1">
                    <X className="h-4 w-4" /> Cancel
                  </Button>
                  <Button variant="outline" size="sm" onClick={resetLayout} disabled={savingLayout} className="gap-1">
                    <RefreshCw className="h-4 w-4" /> Reset
                  </Button>
                  <Button size="sm" onClick={saveLayout} disabled={savingLayout || !dirtyLayout} className="gap-1">
                    <Save className="h-4 w-4" /> {savingLayout ? "Saving..." : "Save Map"}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setEditMode(true)} className="gap-1">
                  <Pencil className="h-4 w-4" /> Edit Map
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Building codes are matched to the campus map and colored by current building health.
        </p>
        {editMode && (
          <p className="text-xs text-muted-foreground">
            Drag the building bubbles where you want them, then click <span className="font-medium text-foreground">Save Map</span>.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-green-500" /> All mapped devices up</div>
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-400" /> One or more mapped devices degraded</div>
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-red-500" /> One or more mapped devices down</div>
          <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-gray-300" /> No live building match yet</div>
        </div>

        <div ref={mapRef} className="relative overflow-hidden rounded-2xl border bg-[#dfe8d8]">
          <style>{`
            @keyframes campusFiberPulse {
              0%, 100% { opacity: 0.5; filter: drop-shadow(0 0 1px rgba(34, 197, 94, 0.3)); }
              50% { opacity: 1; filter: drop-shadow(0 0 8px rgba(34, 197, 94, 0.85)); }
            }
            .campus-fiber-live {
              animation: campusFiberPulse 1.8s ease-in-out infinite;
            }
          `}</style>
          <img
            src={`${import.meta.env.BASE_URL}network/campus-map.png`}
            alt="SCCC campus map with live building status overlays"
            className="block w-full"
            draggable={false}
          />
          <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path
              d={`M ${INTERNET_UPLINK_POINT.x} ${INTERNET_UPLINK_POINT.y} C 8 ${INTERNET_UPLINK_POINT.y - 1.5}, 20 ${HOBBLE_FIBER_HUB.y - 1.2}, ${HOBBLE_FIBER_HUB.x} ${HOBBLE_FIBER_HUB.y}`}
              fill="none"
              stroke="#244233"
              strokeWidth="0.7"
              strokeLinecap="round"
              strokeOpacity="0.7"
            />
            <path
              d={`M ${INTERNET_UPLINK_POINT.x} ${INTERNET_UPLINK_POINT.y} C 8 ${INTERNET_UPLINK_POINT.y - 1.5}, 20 ${HOBBLE_FIBER_HUB.y - 1.2}, ${HOBBLE_FIBER_HUB.x} ${HOBBLE_FIBER_HUB.y}`}
              fill="none"
              stroke="#22c55e"
              strokeWidth="0.44"
              strokeLinecap="round"
              strokeDasharray="1.2 0.8"
              className="campus-fiber-live"
            />
            {(() => {
              const westCampus = overlays.find((overlay) => overlay.code === "WEST");
              const westHealth = buildingByCode.get("WEST")?.healthColor ?? "unknown";
              const westColor = lineColorForHealth(westHealth);
              const westLive = westHealth === "green";
              if (!westCampus) return null;
              return (
                <g>
                  <path
                    d={`M ${westCampus.x} ${westCampus.y} Q 10 ${westCampus.y - 6.5} ${HOBBLE_FIBER_HUB.x} ${HOBBLE_FIBER_HUB.y}`}
                    fill="none"
                    stroke="#244233"
                    strokeWidth="0.6"
                    strokeLinecap="round"
                    strokeOpacity="0.55"
                  />
                  <path
                    d={`M ${westCampus.x} ${westCampus.y} Q 10 ${westCampus.y - 6.5} ${HOBBLE_FIBER_HUB.x} ${HOBBLE_FIBER_HUB.y}`}
                    fill="none"
                    stroke={westColor}
                    strokeWidth={westLive ? 0.34 : 0.3}
                    strokeLinecap="round"
                    strokeOpacity={westLive ? 0.95 : 0.85}
                    strokeDasharray={westLive ? "1 0.8" : undefined}
                    className={westLive ? "campus-fiber-live" : undefined}
                  />
                </g>
              );
            })()}
            {fiberLines.map((line) => {
              const color = lineColorForHealth(line.healthColor);
              const isLive = line.healthColor === "green";
              const controlX = (line.x + HOBBLE_FIBER_HUB.x) / 2;
              const controlY = Math.min(line.y, HOBBLE_FIBER_HUB.y) - 3.5;
              return (
                <g key={`fiber-${line.code}`}>
                  <path
                    d={`M ${line.x} ${line.y} Q ${controlX} ${controlY} ${HOBBLE_FIBER_HUB.x} ${HOBBLE_FIBER_HUB.y}`}
                    fill="none"
                    stroke="#244233"
                    strokeWidth="0.6"
                    strokeLinecap="round"
                    strokeOpacity="0.55"
                  />
                  <path
                    d={`M ${line.x} ${line.y} Q ${controlX} ${controlY} ${HOBBLE_FIBER_HUB.x} ${HOBBLE_FIBER_HUB.y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={isLive ? 0.34 : 0.3}
                    strokeLinecap="round"
                    strokeOpacity={isLive ? 0.95 : 0.85}
                    strokeDasharray={isLive ? "1 0.8" : undefined}
                    className={isLive ? "campus-fiber-live" : undefined}
                  />
                </g>
              );
            })}
          </svg>

          {visibleOverlays.map((overlay) => {
            const match = buildingByCode.get(overlay.code);
            const style = healthStyles[match?.healthColor ?? "unknown"];
            const href = match ? `/network/buildings/${encodeURIComponent(match.name)}` : undefined;
            const labelDx = overlay.labelDx ?? 10;
            const labelDy = overlay.labelDy ?? -10;
            const isWestCampus = overlay.code === "WEST";
            const marker = (
              <div
                className={`absolute z-10 ${editMode ? "cursor-grab active:cursor-grabbing" : ""}`}
                style={{ left: `${overlay.x}%`, top: `${overlay.y}%` }}
                title={`${match?.name ?? overlay.buildingName} — ${style.label}`}
                onPointerDown={(event) => beginDrag(event, overlay.code)}
              >
                <div className="relative">
                  <div
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm backdrop-blur-sm transition-transform duration-150 hover:scale-105 ${overlay.code.startsWith("SL") && overlay.code !== "SLC" ? "px-1.5 py-0" : "px-2 py-0.5"} ${style.bg} ${style.border}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`${overlay.code.startsWith("SL") && overlay.code !== "SLC" ? "text-[9px]" : "text-[11px]"} font-bold tracking-[0.08em] text-foreground`}>{overlay.displayCode ?? overlay.code}</span>
                      <span
                        className={`${overlay.code.startsWith("SL") && overlay.code !== "SLC" ? "h-2 w-2" : "h-2.5 w-2.5"} rounded-full ${
                          match?.healthColor === "green"
                            ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.55)]"
                            : match?.healthColor === "amber"
                              ? "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.45)]"
                              : match?.healthColor === "red"
                                ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
                              : "bg-gray-300"
                        }`}
                      />
                    </div>
                  </div>
                  {!overlay.compactMarker && <div
                    className={`absolute min-w-[96px] max-w-[148px] rounded-2xl border px-2.5 py-1.5 shadow-sm backdrop-blur-sm ${style.bg} ${style.border} ${isWestCampus ? "ring-1 ring-[#355842]/40" : ""}`}
                    style={{ transform: `translate(${labelDx}px, ${labelDy}px)` }}
                  >
                    {isWestCampus && (
                      <div className="mb-1 text-[8px] font-bold uppercase leading-none tracking-[0.16em] text-[#355842]">
                        Remote site
                      </div>
                    )}
                    <div className="text-[10px] font-semibold leading-tight text-foreground">
                      {match?.name ?? overlay.buildingName}
                    </div>
                    <div className="mt-0.5 text-[9px] leading-tight text-muted-foreground">{style.label}</div>
                  </div>}
                </div>
              </div>
            );

            if (editMode || publicMode || !href) return <div key={overlay.code}>{marker}</div>;
            return <Link key={overlay.code} href={href}>{marker}</Link>;
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Remote sites like Epworth stay in the building list and network views. West Campus is grouped into a movable off-campus marker on the far left side of the map.
        </p>
      </CardContent>
    </Card>
  );
}

function BuildingsGrid() {
  const [buildings, setBuildings] = useState<BuildingSummary[]>([]);
  const [callingSupport, setCallingSupport] = useState<CallingSupportSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = !!user;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [buildingsResponse, callingResponse] = await Promise.all([
        authFetch(`${API}/network/buildings`, { credentials: "include", cache: "no-store" }),
        authFetch(`${API}/network/calling/support`, { credentials: "include", cache: "no-store" }),
      ]);
      if (!buildingsResponse.ok) throw new Error(await buildingsResponse.text());
      if (!callingResponse.ok) throw new Error(await callingResponse.text());
      setBuildings(await buildingsResponse.json());
      setCallingSupport(await callingResponse.json());
    } catch (e: any) {
      toast({ title: "Failed to load buildings", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = buildings.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  // sort: green first, then amber, then unknown, alpha within
  const sorted = [...filtered].sort((a, b) => {
    const order = { red: 0, amber: 1, green: 2, unknown: 3 };
    const diff = (order[a.healthColor] ?? 3) - (order[b.healthColor] ?? 3);
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });

  const callingAttentionBuildings = (callingSupport?.buildings ?? []).filter(
    (building) => building.healthColor === "red" || building.healthColor === "amber",
  );
  const callingHealthyBuildings = (callingSupport?.buildings ?? []).filter(
    (building) => building.healthColor === "green",
  );
  const offlineWebexDevices = (callingSupport?.devices ?? []).filter((device) => device.status === "offline");
  const missingE911Vlans = callingSupport?.e911Range.missing ?? [];
  const coveredE911Vlans = callingSupport?.e911Range.present ?? [];


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Campus Buildings</h1>
          <Badge variant="outline">{buildings.length} buildings</Badge>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={async () => {
                const name = window.prompt("New building name")?.trim();
                if (!name) return;
                try {
                  const r = await authFetch(`${API}/network/buildings`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name }),
                  });
                  if (!r.ok) throw new Error(await r.text());
                  toast({ title: "Building added", description: name });
                  await load();
                } catch (e: any) {
                  toast({ title: "Building add failed", description: e.message, variant: "destructive" });
                }
              }}
            >
              <Building2 className="h-4 w-4" /> Add Building
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} className="gap-1">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-green-500" /> All devices up</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-400" /> One or more degraded</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-red-500" /> One or more down</div>
        <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-gray-300" /> No live data</div>
      </div>

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Filter buildings..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      <CampusStatusMap buildings={buildings} />

      {callingSupport && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <PhoneCall className="h-5 w-5 text-primary" />
                  Cisco Calling &amp; E-911
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Building-focused support view for Webex status, voice/E-911 VLAN coverage, and quick operational checks.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={callingSupport.links.controlHubOverview} target="_blank" rel="noreferrer">
                    Control Hub <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={callingSupport.links.emergencyCallingGuide} target="_blank" rel="noreferrer">
                    Emergency Calling <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={callingSupport.links.auditEventsReference} target="_blank" rel="noreferrer">
                    Audit Events <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </div>
            {!callingSupport.configured && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Webex is not configured in the hub yet, so this section can still evaluate building/VLAN readiness but cannot read live Webex device inventory.
              </div>
            )}
            {callingSupport.queryError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {callingSupport.queryError}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <SummaryCard
                label="Calling Buildings Healthy"
                value={callingSupport.summary.healthyCallingBuildings}
                icon={<Building2 className="h-5 w-5 text-green-600" />}
                color="text-green-600"
              />
              <SummaryCard
                label="Buildings Needing Review"
                value={callingSupport.summary.attentionCallingBuildings}
                icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
                color={callingSupport.summary.attentionCallingBuildings > 0 ? "text-amber-600" : "text-foreground"}
              />
              <SummaryCard
                label="Webex Devices Online"
                value={callingSupport.summary.onlineWebexDevices}
                icon={<Wifi className="h-5 w-5 text-green-600" />}
                color="text-green-600"
              />
              <SummaryCard
                label="E-911 VLANs Covered"
                value={coveredE911Vlans.length}
                icon={<Activity className="h-5 w-5 text-blue-500" />}
                color="text-blue-600"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Building Support Matrix</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Buildings listed here have calling-related VLANs or calling network dependencies.
                  </p>
                </div>
                <div className="grid gap-3">
                  {callingSupport.buildings.map((building) => (
                    <div key={building.name} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="font-semibold">{building.name}</div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{building.switchCount} switches</span>
                            <span>{building.onlineSwitchCount} online</span>
                            <span>{building.offlineSwitchCount} offline</span>
                            <span>{building.nodeCount} monitored nodes</span>
                          </div>
                        </div>
                        <Badge variant="outline" className={callingHealthBadgeClass[building.healthColor] ?? callingHealthBadgeClass.gray}>
                          {callingHealthLabel[building.healthColor] ?? callingHealthLabel.gray}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {building.e911Vlans.length > 0 ? building.e911Vlans.map((vlan) => (
                          <Badge key={vlan.id} variant="secondary" className="h-auto whitespace-normal px-2 py-1 text-left">
                            VLAN {vlan.vlanId} {vlan.name}
                            {vlan.subnet ? ` • ${vlan.subnet}` : ""}
                            {vlan.gateway ? ` • gw ${vlan.gateway}` : ""}
                          </Badge>
                        )) : (
                          <Badge variant="outline">No calling VLAN mapped yet</Badge>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Monitoring strategy: {building.monitoringStrategy}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tests &amp; Automation</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Built-in checks and the next automation targets to make calling support more deterministic.
                  </p>
                </div>

                <div className="rounded-xl border p-4">
                  <h4 className="font-medium">Current automated checks</h4>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>Building health is correlated with calling-related VLAN ownership, so a red building is treated as a likely site/network issue before blaming the cloud.</li>
                    <li>Voice and E-911 VLAN coverage is checked against the expected `301-{callingSupport.e911Range.end}` range.</li>
                    <li>Live Webex device inventory is compared against building readiness when the Webex service-app credentials are present.</li>
                  </ul>
                </div>

                <div className="rounded-xl border p-4">
                  <h4 className="font-medium">Configuration cleanup</h4>
                  <div className="mt-3 space-y-3 text-sm">
                    <div>
                      <div className="font-medium text-foreground">Missing E-911 VLAN coverage</div>
                      <div className="text-muted-foreground">
                        {missingE911Vlans.length > 0
                          ? `Missing VLANs: ${missingE911Vlans.join(", ")}`
                          : "All expected E-911 VLAN IDs are represented in the current building inventory."}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Buildings needing operator review</div>
                      <div className="text-muted-foreground">
                        {callingAttentionBuildings.length > 0
                          ? callingAttentionBuildings.map((building) => building.name).join(", ")
                          : "No calling buildings are currently flagged for network review."}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">Offline Webex endpoints</div>
                      <div className="text-muted-foreground">
                        {offlineWebexDevices.length > 0
                          ? `${offlineWebexDevices.length} device(s) are offline in Webex and should be compared against the building matrix.`
                          : "No Webex devices are currently reported offline."}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <h4 className="font-medium">Recommended next automation</h4>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>Add Webex workspace-to-building mapping so room devices can be pinned directly to the campus map and building detail pages.</li>
                    <li>Add an audit-events ingest so configuration changes in Control Hub are surfaced next to outages and maintenance history.</li>
                    <li>Add a calling-readiness report that flags buildings with missing voice VLANs, unhealthy uplinks, or Webex devices offline while the building network is green.</li>
                  </ul>
                </div>

                <div className="rounded-xl border p-4">
                  <h4 className="font-medium">Quick triage order</h4>
                  <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <li>Check whether the affected building is green here.</li>
                    <li>Confirm the building has the expected calling/E-911 VLAN mapped.</li>
                    <li>If the building is green, compare the room/device against the Webex device list and audit events.</li>
                    <li>If the building is red or amber, treat the network path first and escalate to Control Hub only after the building is stable.</li>
                  </ol>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-center py-16">
          {search ? "No buildings match your search." : "No buildings found. Add devices with a building name to see them here."}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {sorted.map(b => {
            const style = healthStyles[b.healthColor];
            return (
              <Link key={b.name} href={`/network/buildings/${encodeURIComponent(b.name)}`}>
                <div className={`
                  relative rounded-xl border-2 p-4 cursor-pointer transition-all duration-150
                  ${style.bg} ${style.border}
                  hover:shadow-md hover:scale-[1.02]
                `}>
                  {/* Health indicator dot */}
                  <div className={`absolute top-2 right-2 h-2.5 w-2.5 rounded-full ${
                    b.healthColor === "green" ? "bg-green-500 shadow-[0_0_6px_#22c55e]"
                    : b.healthColor === "amber" ? "bg-amber-400 shadow-[0_0_6px_#f59e0b]"
                    : b.healthColor === "red" ? "bg-red-500 shadow-[0_0_6px_#ef4444]"
                    : "bg-gray-300"
                  }`} />

                  <div className="flex flex-col gap-2">
                    <div className="text-muted-foreground">{style.icon}</div>
                    <div>
                      <p className="font-semibold text-sm leading-tight">{b.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{style.label}</p>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        <Server className="h-3 w-3 inline mr-0.5" />{b.nodeCount}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        VLANs: {b.vlanCount}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Building Detail View ─────────────────────────────────────────────────────

function BuildingDetailView({ name }: { name: string }) {
  const [detail, setDetail] = useState<BuildingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = !!user;
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(name);
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`${API}/network/buildings/${encodeURIComponent(name)}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      setDetail(await r.json());
    } catch (e: any) {
      toast({ title: "Failed to load building", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [name, toast]);

  useEffect(() => { load(); }, [load]);

  const saveBuildingName = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === name) { setEditingName(false); return; }
    setSavingName(true);
    try {
      const r = await authFetch(`${API}/network/buildings/${encodeURIComponent(name)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Building override saved", description: `${name} renamed to ${trimmed}.` });
      window.location.assign(`/network/buildings/${encodeURIComponent(trimmed)}`);
    } catch (e: any) {
      toast({ title: "Building update failed", description: e.message, variant: "destructive" });
    } finally { setSavingName(false); }
  };


  const editVlanBuilding = async (vlan: VlanSummary) => {
    const building = window.prompt(`Move VLAN ${vlan.vlanId} to which building?`, vlan.building || name)?.trim();
    if (!building || building === vlan.building) return;
    try {
      const r = await authFetch(`${API}/network/vlans/${vlan.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "VLAN moved", description: `VLAN ${vlan.vlanId} is now assigned to ${building}.` });
      await load();
    } catch (e: any) {
      toast({ title: "VLAN update failed", description: e.message, variant: "destructive" });
    }
  };
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Building not found.{" "}
        <Link href="/network/buildings"><span className="text-primary underline cursor-pointer">All Buildings</span></Link>
      </div>
    );
  }

  const style = healthStyles[detail.healthColor];

  const upCount = detail.nodes.filter(n => n.liveStatus === "up").length;
  const downCount = detail.nodes.filter(n => n.liveStatus === "down").length;
  const degradedCount = detail.nodes.filter(n => n.liveStatus === "degraded").length;
  const unknownCount = detail.nodes.filter(n => n.liveStatus === "unknown").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href="/network">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Network
          </Button>
        </Link>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <Link href="/network/buildings">
          <Button variant="ghost" size="sm" className="gap-1">
            <Building2 className="h-4 w-4" /> Buildings
          </Button>
        </Link>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <div className="flex items-center gap-2 flex-1">
          {style.icon}
                    {editingName ? (
            <div className="flex items-center gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9 w-64" aria-label="Building name" />
              <Button size="sm" onClick={saveBuildingName} disabled={savingName}><Save className="h-4 w-4 mr-1" />Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingName(false); setNewName(name); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : <h1 className="text-2xl font-bold">{detail.name}</h1>}
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
            detail.healthColor === "green" ? "bg-green-100 text-green-700 border-green-300"
            : detail.healthColor === "amber" ? "bg-amber-100 text-amber-700 border-amber-300"
            : detail.healthColor === "red" ? "bg-red-100 text-red-700 border-red-300"
            : "bg-gray-100 text-gray-600 border-gray-300"
          }`}>{style.label}</span>
        </div>
        {canEdit && !editingName && (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditingName(true)} className="gap-1"><Pencil className="h-4 w-4" /> Edit Building</Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!window.confirm(`Delete building ${detail.name}?`)) return;
                try {
                  const r = await authFetch(`${API}/network/buildings/${encodeURIComponent(detail.name)}`, { method: "DELETE" });
                  if (!r.ok) throw new Error(await r.text());
                  toast({ title: "Building deleted", description: detail.name });
                  window.location.assign("/network/buildings");
                } catch (e: any) {
                  toast({ title: "Building delete failed", description: e.message, variant: "destructive" });
                }
              }}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Delete Building
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={load} className="gap-1">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Devices" value={detail.nodes.length} icon={<Server className="h-5 w-5 text-primary" />} />
        <SummaryCard label="VLANs" value={detail.vlans.length} icon={<Activity className="h-5 w-5 text-blue-500" />} />
        {detail.influxConfigured ? (
          <>
            <SummaryCard label="Up" value={upCount} icon={<Wifi className="h-5 w-5 text-green-600" />} color="text-green-600" />
            <SummaryCard label="Issues" value={downCount + degradedCount} icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
              color={downCount + degradedCount > 0 ? "text-amber-600" : "text-gray-500"} />
          </>
        ) : (
          <div className="col-span-2 flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-2">
            <Activity className="h-4 w-4 opacity-50" />
            Live status available after InfluxDB connection
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">Devices ({detail.nodes.length})</TabsTrigger>
          <TabsTrigger value="vlans">VLANs ({detail.vlans.length})</TabsTrigger>
        </TabsList>

        {/* Devices Tab */}
        <TabsContent value="devices" className="mt-4">
          {detail.nodes.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No devices associated with this building.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table className="table-fixed min-w-[1050px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[18rem]">Hostname</TableHead>
                    <TableHead className="w-[8rem]">Type</TableHead>
                    <TableHead className="w-[15rem]">Vendor / Model</TableHead>
                    <TableHead className="w-[9rem]">Mgmt IP</TableHead>
                    <TableHead className="w-[12rem]">Location</TableHead>
                    <TableHead className="w-[9rem]">Role</TableHead>
                    <TableHead className="w-[8rem]">Criticality</TableHead>
                    <TableHead className="w-[7rem]">Status</TableHead>
                    {detail.influxConfigured && <TableHead className="w-[6rem]">Live</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.nodes.map(node => (
                    <TableRow key={node.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="align-top">
                        <Link href={`/network/nodes/${node.id}`}>
                          <span
                            className="block truncate text-primary underline font-medium text-sm"
                            title={node.displayName || node.hostname}
                          >
                            {node.displayName || node.hostname}
                          </span>
                        </Link>
                        {node.displayName && (
                          <div className="truncate text-xs text-muted-foreground" title={node.hostname}>
                            {node.hostname}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className="capitalize text-xs">{node.nodeKind}</Badge>
                      </TableCell>
                      <TableCell
                        className="truncate text-xs align-top"
                        title={[node.vendor, node.model].filter(Boolean).join(" ") || "—"}
                      >
                        {[node.vendor, node.model].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs align-top">{node.mgmtIp ?? "—"}</TableCell>
                      <TableCell className="truncate text-xs align-top" title={node.location ?? "—"}>{node.location ?? "—"}</TableCell>
                      <TableCell className="truncate text-xs align-top" title={node.role ?? "—"}>{node.role ?? "—"}</TableCell>
                      <TableCell className="align-top">
                        {node.criticality ? (
                          <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium capitalize ${critColor(node.criticality)}`}>
                            {node.criticality}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs align-top">{node.status ?? "—"}</TableCell>
                      {detail.influxConfigured && (
                        <TableCell className="align-top"><LiveBadge status={node.liveStatus} /></TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* VLANs Tab */}
        <TabsContent value="vlans" className="mt-4">
          {detail.vlans.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">No VLANs associated with this building.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table className="table-fixed min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[7rem]">VLAN ID</TableHead>
                    <TableHead className="w-[12rem]">Name</TableHead>
                    <TableHead className="w-[18rem]">Description</TableHead>
                    <TableHead className="w-[12rem]">IP Range</TableHead>
                    <TableHead className="w-[12rem]">Purpose</TableHead>
                    {canEdit && <TableHead className="w-[8rem] text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.vlans
                    .sort((a, b) => (a.vlanId ?? a.id) - (b.vlanId ?? b.id))
                    .map(vlan => (
                      <TableRow key={vlan.id}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">{vlan.vlanId ?? vlan.id}</Badge>
                        </TableCell>
                        <TableCell className="truncate font-medium text-sm" title={vlan.name ?? "—"}>{vlan.name ?? "—"}</TableCell>
                        <TableCell className="truncate text-xs text-muted-foreground" title={vlan.description ?? "—"}>{vlan.description ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{vlan.ipRange ?? "—"}</TableCell>
                        <TableCell className="truncate text-xs" title={vlan.vlanPurpose ?? "—"}>{vlan.vlanPurpose ?? "—"}</TableCell>
                        {canEdit && <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => editVlanBuilding(vlan)}><Pencil className="h-4 w-4 mr-1" /> Edit</Button></TableCell>}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon, color = "text-foreground",
}: { label: string; value: number; icon: React.ReactNode; color?: string }) {
  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BuildingsEmbedPage() {
  const { toast } = useToast();
  const [buildings, setBuildings] = useState<BuildingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(PUBLIC_BUILDINGS_API);
      if (!response.ok) throw new Error(await response.text());
      const nextBuildings = (await response.json()) as BuildingSummary[];
      setBuildings(nextBuildings);
      setLoadError(null);
    } catch (error: any) {
      const message = error?.message ?? "Unable to load the public campus status map.";
      setLoadError(message);
      if (buildings.length === 0) {
        toast({
          title: "Failed to load campus map",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [buildings.length, toast]);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Campus Status Map</h1>
            <p className="text-sm text-muted-foreground">
              Public read-only embed for dashboards. Refreshes automatically every 30 seconds.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {loadError && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            The map shell is public, but live building data could not be refreshed right now.
          </div>
        )}

        {loading && buildings.length === 0 ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-2xl border bg-card">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <CampusStatusMap buildings={buildings} publicMode />
        )}
      </div>
    </div>
  );
}

// ─── Root Export — handles both /buildings and /buildings/:name ────────────────

export default function Buildings() {
  const params = useParams<{ name?: string }>();
  const buildingName = params?.name ? decodeURIComponent(params.name) : undefined;

  return buildingName ? <BuildingDetailView name={buildingName} /> : <BuildingsGrid />;
}
