export type ExistingTelemetryPort = {
  interfaceName: string; isPhysical?: boolean | null; telemetryUpdatedAt?: Date | null;
  operStatus?: string | null; adminStatus?: string | null; nativeVlan?: number | null; description?: string | null;
};

export type ObservedTelemetryPort = {
  interfaceName: string; operStatus: string | null; adminStatus: string | null;
  nativeVlan: number | null; description: string | null;
};

const key = (value: string) => value.trim().toLowerCase().replace(/^ethernet/, "eth");

export function computeTelemetryPortDelta(existingPorts: ExistingTelemetryPort[], observedPorts: ObservedTelemetryPort[]) {
  const existingByName = new Map(existingPorts.map((port) => [key(port.interfaceName), port]));
  const observed = new Set<string>();
  const changes: Array<{ port: string; kind: "oper" | "admin" | "native_vlan" | "description" | "added" | "missing"; before: string | number | null; after: string | number | null }> = [];
  const totals = { downToUp: 0, upToDown: 0, adminChanges: 0, vlanChanges: 0, descriptionChanges: 0, portsAdded: 0, portsMissing: 0 };
  for (const after of observedPorts) {
    const portKey = key(after.interfaceName);
    observed.add(portKey);
    const before = existingByName.get(portKey);
    if (!before?.telemetryUpdatedAt) {
      totals.portsAdded++;
      changes.push({ port: after.interfaceName, kind: "added", before: null, after: after.operStatus });
      continue;
    }
    if (before.operStatus === "down" && after.operStatus === "up") {
      totals.downToUp++; changes.push({ port: after.interfaceName, kind: "oper", before: "down", after: "up" });
    } else if (before.operStatus === "up" && after.operStatus === "down") {
      totals.upToDown++; changes.push({ port: after.interfaceName, kind: "oper", before: "up", after: "down" });
    }
    if (before.adminStatus != null && after.adminStatus != null && before.adminStatus !== after.adminStatus) {
      totals.adminChanges++; changes.push({ port: after.interfaceName, kind: "admin", before: before.adminStatus, after: after.adminStatus });
    }
    if (before.nativeVlan != null && after.nativeVlan != null && before.nativeVlan !== after.nativeVlan) {
      totals.vlanChanges++; changes.push({ port: after.interfaceName, kind: "native_vlan", before: before.nativeVlan, after: after.nativeVlan });
    }
    if (before.description && after.description && before.description !== after.description) {
      totals.descriptionChanges++; changes.push({ port: after.interfaceName, kind: "description", before: before.description, after: after.description });
    }
  }
  for (const before of existingPorts) {
    if (before.telemetryUpdatedAt && before.isPhysical !== false && !observed.has(key(before.interfaceName))) {
      totals.portsMissing++; changes.push({ port: before.interfaceName, kind: "missing", before: before.operStatus ?? null, after: null });
    }
  }
  return { ...totals, changes };
}
