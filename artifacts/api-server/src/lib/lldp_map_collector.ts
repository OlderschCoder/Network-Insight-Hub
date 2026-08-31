import { db, netLinksTable, netNodesTable } from "@workspace/db";
import { netPortsTable } from "@workspace/db/net_ports";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { collectLldpViaNoc } from "./noc_probe";

export interface LldpMapCollectionSummary {
  vantage: string;
  capturedAt: string;
  targets: number;
  successful: number;
  failed: number;
  neighbors: number;
  interfaces: number;
  portsInserted: number;
  portsUpdated: number;
  linksInserted: number;
  linksUpdated: number;
  linksSkipped: number;
  unmatchedNeighbors: string[];
  failedSwitches: Array<{ hostname: string; error: string }>;
}

function canonicalHostname(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/\.sccc\.edu$/i, "")
    .replace(/[#>()\s]+$/, "")
    .trim();
}

function canonicalPortName(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^HundredGig(?:abitEthernet|E)/i, "Hu")
    .replace(/^FortyGigabitEthernet/i, "Fo")
    .replace(/^TwentyFiveGigE/i, "Tw")
    .replace(/^TenGigabitEthernet/i, "Te")
    .replace(/^GigabitEthernet/i, "Gi")
    .replace(/^FastEthernet/i, "Fa")
    .replace(/^Ethernet/i, "Eth")
    .replace(/^Port-channel/i, "Po")
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function isPrivateIpv4(value: string): boolean {
  const match = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function counterBigInt(raw: unknown): bigint | null {
  try {
    const value = String(raw ?? "").trim();
    return /^\d+$/.test(value) ? BigInt(value) : null;
  } catch {
    return null;
  }
}

function canonicalLink(
  aNodeId: string,
  aPort: string,
  bNodeId: string,
  bPort: string,
): { aNodeId: string; aPort: string; bNodeId: string; bPort: string; key: string } {
  let aId = aNodeId;
  let aName = canonicalPortName(aPort);
  let bId = bNodeId;
  let bName = canonicalPortName(bPort);
  if (aId > bId) {
    [aId, bId] = [bId, aId];
    [aName, bName] = [bName, aName];
  }
  return {
    aNodeId: aId,
    aPort: aName,
    bNodeId: bId,
    bPort: bName,
    key: `${aId}:${aName.toLowerCase()}|${bId}:${bName.toLowerCase()}`,
  };
}

export async function collectLldpIntoNetworkMap(): Promise<LldpMapCollectionSummary> {
  const nodes = await db.select().from(netNodesTable);
  const targetNodes = nodes
    .filter((node) =>
      ["switch", "router"].includes(node.nodeKind) &&
      !!node.mgmtIp &&
      isPrivateIpv4(node.mgmtIp),
    )
    .sort((a, b) => a.hostname.localeCompare(b.hostname));

  if (!targetNodes.length) {
    throw new Error("No switch or router management IPs are configured in Network Map.");
  }
  if (targetNodes.length > 256) {
    throw new Error(`${targetNodes.length} targets exceed the approved 256-switch limit.`);
  }

  const collection = await collectLldpViaNoc(
    targetNodes.map((node) => ({ hostname: node.hostname, ip: node.mgmtIp! })),
  );
  const capturedAt = new Date(collection.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) {
    throw new Error("The NOC probe returned an invalid collection timestamp.");
  }

  const nodeByHostname = new Map(nodes.map((node) => [canonicalHostname(node.hostname), node]));
  const nodeByIp = new Map(nodes.filter((node) => node.mgmtIp).map((node) => [node.mgmtIp!, node]));
  const existingPorts = await db.select().from(netPortsTable);
  const portByKey = new Map(
    existingPorts.map((port) => [
      `${port.nodeId}:${canonicalPortName(port.interfaceName).toLowerCase()}`,
      port,
    ]),
  );
  let portsInserted = 0;
  let portsUpdated = 0;

  for (const device of collection.results) {
    if (!device.ok) continue;
    const source = nodeByHostname.get(canonicalHostname(device.hostname)) ?? nodeByIp.get(device.ip);
    if (!source) continue;

    for (const observation of device.interfaces ?? []) {
      const interfaceName = canonicalPortName(observation.interfaceName);
      if (!interfaceName) continue;
      const key = `${source.id}:${interfaceName.toLowerCase()}`;
      const previous = portByKey.get(key);
      const currentIn = counterBigInt(observation.inOctets);
      const currentOut = counterBigInt(observation.outOctets);
      const priorIn = counterBigInt(previous?.inOctets);
      const priorOut = counterBigInt(previous?.outOctets);
      const previousAt = previous?.telemetryUpdatedAt ? new Date(previous.telemetryUpdatedAt) : null;
      const elapsedSeconds = previousAt ? (capturedAt.getTime() - previousAt.getTime()) / 1000 : 0;
      let inBps: number | null = null;
      let outBps: number | null = null;
      if (
        elapsedSeconds > 0 && elapsedSeconds <= 86_400 &&
        currentIn != null && currentOut != null && priorIn != null && priorOut != null &&
        currentIn >= priorIn && currentOut >= priorOut
      ) {
        inBps = Math.round(Number(currentIn - priorIn) * 8 / elapsedSeconds);
        outBps = Math.round(Number(currentOut - priorOut) * 8 / elapsedSeconds);
      }
      const speedMbps = observation.speedMbps && observation.speedMbps > 0
        ? observation.speedMbps
        : previous?.speedMbps ?? null;
      const utilizationPct = speedMbps && inBps != null && outBps != null
        ? Math.min(100, Math.round((Math.max(inBps, outBps) / (speedMbps * 1_000_000)) * 10_000) / 100)
        : null;
      const hasConfig = !!previous?.configUpdatedAt;
      const values = {
        nodeId: source.id,
        interfaceName,
        ifIndex: observation.ifIndex,
        isPhysical: observation.isPhysical !== false,
        description: previous?.description || observation.description || null,
        ifType: observation.ifType ?? null,
        mtu: observation.mtu ?? null,
        macAddress: observation.macAddress || null,
        adminStatus: observation.adminStatus || previous?.adminStatus || null,
        operStatus: observation.operStatus || null,
        speedMbps,
        portMode: hasConfig && previous?.portMode
          ? previous.portMode
          : observation.portMode || previous?.portMode || null,
        nativeVlan: hasConfig && previous?.nativeVlan != null
          ? previous.nativeVlan
          : observation.nativeVlan ?? previous?.nativeVlan ?? null,
        allowedVlans: hasConfig && previous?.allowedVlans
          ? previous.allowedVlans
          : observation.allowedVlans ?? previous?.allowedVlans ?? null,
        portchannel: hasConfig && previous?.portchannel
          ? previous.portchannel
          : observation.portchannel || previous?.portchannel || null,
        vpcId: previous?.vpcId ?? null,
        inErrors: observation.inErrors ?? null,
        outErrors: observation.outErrors ?? null,
        inDiscards: observation.inDiscards ?? null,
        outDiscards: observation.outDiscards ?? null,
        inOctets: currentIn?.toString() ?? null,
        outOctets: currentOut?.toString() ?? null,
        inBps,
        outBps,
        utilizationPct,
        telemetryEvidence: `snmp:10.0.0.22:${device.ip}`.slice(0, 300),
        telemetryUpdatedAt: capturedAt,
        updatedAt: new Date(),
      };
      const [saved] = await db
        .insert(netPortsTable)
        .values(values)
        .onConflictDoUpdate({
          target: [netPortsTable.nodeId, netPortsTable.interfaceName],
          set: values,
        })
        .returning();
      portByKey.set(key, saved);
      if (previous) portsUpdated++; else portsInserted++;
    }
  }

  const existingLinks = await db.select().from(netLinksTable);
  const linkByKey = new Map(
    existingLinks.map((link) => {
      const canonical = canonicalLink(link.aNodeId, link.aPort, link.bNodeId, link.bPort);
      return [canonical.key, link] as const;
    }),
  );
  let linksInserted = 0;
  let linksUpdated = 0;
  let linksSkipped = 0;
  const unmatched = new Set<string>();
  const evidenceRef = `lldp-snmp:10.0.0.22:${collection.capturedAt}`.slice(0, 300);

  for (const device of collection.results) {
    if (!device.ok) continue;
    const source = nodeByHostname.get(canonicalHostname(device.hostname)) ?? nodeByIp.get(device.ip);
    if (!source) continue;

    for (const neighbor of device.neighbors ?? []) {
      const remoteName = canonicalHostname(neighbor.remoteSystemName || "");
      const peer = remoteName ? nodeByHostname.get(remoteName) : undefined;
      if (!peer) {
        unmatched.add(remoteName || neighbor.remoteChassisId || "unnamed-neighbor");
        continue;
      }
      if (source.id === peer.id) {
        linksSkipped++;
        continue;
      }

      const sourcePortName = canonicalPortName(String(neighbor.localPort || neighbor.localPortNum || "unknown"));
      const sourcePort = portByKey.get(`${source.id}:${sourcePortName.toLowerCase()}`);
      const canonical = canonicalLink(
        source.id,
        sourcePortName,
        peer.id,
        canonicalPortName(String(neighbor.remotePort || "unknown")),
      );
      const existing = linkByKey.get(canonical.key);
      const liveDetails = {
        confidence: "confirmed_lldp" as const,
        lastVerifiedAt: capturedAt,
        evidenceRef,
        lldpPeerHostname: remoteName,
        speedMbps: sourcePort?.speedMbps ?? null,
        portMode: sourcePort?.portMode ?? null,
        nativeVlan: sourcePort?.nativeVlan ?? null,
        allowedVlans: sourcePort?.allowedVlans ?? null,
        portchannel: sourcePort?.portchannel ?? null,
        updatedAt: new Date(),
      };

      if (existing) {
        await db.update(netLinksTable).set(liveDetails).where(eq(netLinksTable.id, existing.id));
        linksUpdated++;
      } else {
        const [saved] = await db.insert(netLinksTable).values({
          aNodeId: canonical.aNodeId,
          aPort: canonical.aPort,
          bNodeId: canonical.bNodeId,
          bPort: canonical.bPort,
          linkKind: "unknown",
          ...liveDetails,
        }).returning();
        linkByKey.set(canonical.key, saved);
        linksInserted++;
      }
    }
  }

  const summary: LldpMapCollectionSummary = {
    vantage: collection.vantage || "10.0.0.22",
    capturedAt: collection.capturedAt,
    targets: collection.targets,
    successful: collection.successful,
    failed: collection.failed,
    neighbors: collection.neighbors,
    interfaces: collection.interfaces,
    portsInserted,
    portsUpdated,
    linksInserted,
    linksUpdated,
    linksSkipped,
    unmatchedNeighbors: [...unmatched].sort(),
    failedSwitches: collection.results
      .filter((result) => !result.ok)
      .map((result) => ({ hostname: result.hostname, error: result.error || "No SNMP response" })),
  };
  logger.info(summary, "LLDP collector updated Network Map");
  return summary;
}
