import {
  db,
  deviceConfigsTable,
  inventoryAuditTable,
  netLinksTable,
  netNodesTable,
  netPortsTable,
  netRoutingAdjacenciesTable,
  networkLayoutPositionsTable,
  networkSwitchesTable,
} from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import { deleteConfirmationMatches } from "./fred_confirmation";
import {
  diffFields,
  SWITCH_AUDIT_FIELDS,
  type InventoryActor,
} from "./inventory";
import { topologyNodeMatchesSwitch } from "./network_retirement_policy";

export type NetworkAssetRetirementResult =
  | { status: "not_found" }
  | { status: "no_maintained_switch"; nodeId: string }
  | {
      status: "confirmation_required";
      switchId: number;
      hostname: string;
      confirmation: string;
    }
  | {
      status: "deleted";
      switchId: number;
      hostname: string;
      topologyNodesDeleted: number;
      portsDeleted: number;
      linksDeleted: number;
      routingAdjacenciesDeleted: number;
      configurationBackupsPreserved: number;
    };

/**
 * Retire one maintained physical asset and all of its topology projections.
 * Configuration backups are preserved (their switch FK becomes null), and the
 * attributed deletion audit is committed in the same transaction.
 */
export async function retireNetworkAsset(opts: {
  switchId?: number;
  nodeId?: string;
  confirmation?: string;
  actor: InventoryActor;
}): Promise<NetworkAssetRetirementResult> {
  return db.transaction(async (tx) => {
    let requestedNode: typeof netNodesTable.$inferSelect | null = null;
    if (opts.nodeId) {
      const [foundNode] = await tx
        .select()
        .from(netNodesTable)
        .where(eq(netNodesTable.id, opts.nodeId));
      requestedNode = foundNode ?? null;
      if (!requestedNode) return { status: "not_found" as const };
    }

    let networkSwitch: typeof networkSwitchesTable.$inferSelect | null = null;
    if (opts.switchId != null) {
      const [foundSwitch] = await tx
        .select()
        .from(networkSwitchesTable)
        .where(eq(networkSwitchesTable.id, opts.switchId));
      networkSwitch = foundSwitch ?? null;
      if (!networkSwitch) return { status: "not_found" as const };
    } else if (requestedNode) {
      const switches = await tx.select().from(networkSwitchesTable);
      networkSwitch =
        switches.find((candidate) =>
          topologyNodeMatchesSwitch(candidate, requestedNode!),
        ) ?? null;
      if (!networkSwitch) {
        return {
          status: "no_maintained_switch" as const,
          nodeId: requestedNode.id,
        };
      }
    }

    if (!networkSwitch) return { status: "not_found" as const };

    const confirmation = `CONFIRM DELETE switch ${networkSwitch.hostname}`;
    if (
      !deleteConfirmationMatches(
        opts.confirmation,
        "switch",
        networkSwitch.hostname,
      )
    ) {
      return {
        status: "confirmation_required" as const,
        switchId: networkSwitch.id,
        hostname: networkSwitch.hostname,
        confirmation,
      };
    }

    const allNodes = await tx.select().from(netNodesTable);
    const topologyNodes = allNodes.filter((node) =>
      topologyNodeMatchesSwitch(networkSwitch!, node),
    );
    const nodeIds = topologyNodes.map((node) => node.id);

    const configurationBackups = await tx
      .select({ id: deviceConfigsTable.id })
      .from(deviceConfigsTable)
      .where(eq(deviceConfigsTable.switchId, networkSwitch.id));
    const [ports, links, routingAdjacencies] = nodeIds.length > 0
      ? await Promise.all([
            tx
              .select({ id: netPortsTable.id })
              .from(netPortsTable)
              .where(inArray(netPortsTable.nodeId, nodeIds)),
            tx
              .select({ id: netLinksTable.id })
              .from(netLinksTable)
              .where(
                or(
                  inArray(netLinksTable.aNodeId, nodeIds),
                  inArray(netLinksTable.bNodeId, nodeIds),
                ),
              ),
            tx
              .select({ id: netRoutingAdjacenciesTable.id })
              .from(netRoutingAdjacenciesTable)
              .where(
                inArray(netRoutingAdjacenciesTable.deviceNodeId, nodeIds),
              ),
          ])
      : [[], [], []];

    if (nodeIds.length > 0) {
      await tx
        .delete(netLinksTable)
        .where(
          or(
            inArray(netLinksTable.aNodeId, nodeIds),
            inArray(netLinksTable.bNodeId, nodeIds),
          ),
        );
      await tx
        .delete(netPortsTable)
        .where(inArray(netPortsTable.nodeId, nodeIds));
      await tx
        .delete(netRoutingAdjacenciesTable)
        .where(inArray(netRoutingAdjacenciesTable.deviceNodeId, nodeIds));
      await tx
        .delete(networkLayoutPositionsTable)
        .where(inArray(networkLayoutPositionsTable.nodeId, nodeIds));
      await tx.delete(netNodesTable).where(inArray(netNodesTable.id, nodeIds));
    }

    const changes = [
      ...diffFields(networkSwitch, {}, SWITCH_AUDIT_FIELDS),
      ...(topologyNodes.length > 0
        ? [
            {
              field: "topologyNodes",
              from: topologyNodes.map((node) => ({
                id: node.id,
                hostname: node.hostname,
                managementIp: node.mgmtIp,
              })),
              to: null,
            },
          ]
        : []),
      { field: "ports", from: ports.length, to: 0 },
      { field: "links", from: links.length, to: 0 },
      {
        field: "routingAdjacencies",
        from: routingAdjacencies.length,
        to: 0,
      },
      {
        field: "configurationBackupsDetached",
        from: { count: configurationBackups.length, switchId: networkSwitch.id },
        to: { count: configurationBackups.length, switchId: null },
      },
    ];

    await tx.insert(inventoryAuditTable).values({
      entityType: "switch",
      entityId: networkSwitch.id,
      entityLabel: networkSwitch.hostname,
      action: "delete",
      source: "manual",
      actorId: opts.actor.id ?? undefined,
      actorName: opts.actor.name ?? undefined,
      changes,
    });
    await tx
      .delete(networkSwitchesTable)
      .where(eq(networkSwitchesTable.id, networkSwitch.id));

    return {
      status: "deleted" as const,
      switchId: networkSwitch.id,
      hostname: networkSwitch.hostname,
      topologyNodesDeleted: topologyNodes.length,
      portsDeleted: ports.length,
      linksDeleted: links.length,
      routingAdjacenciesDeleted: routingAdjacencies.length,
      configurationBackupsPreserved: configurationBackups.length,
    };
  });
}
