function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
}

export function extractNetworkConfigFacts(configs: any[]): any[] {
  const seenDevices = new Set<string>();
  return [...configs]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .flatMap((config) => {
      const device = String(config.deviceName ?? "unknown");
      if (seenDevices.has(device.toLowerCase())) return [];
      seenDevices.add(device.toLowerCase());
      const facts = String(config.content ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /\b(?:vrf|vdom|router ospf|router bgp|ip route|route-map|interface vlan|vlan interface)\b/i.test(line))
        .filter((line) => !/password|secret|community|pre-shared|private-key/i.test(line))
        .filter((line, index, rows) => rows.indexOf(line) === index)
        .slice(0, 120);
      return [{ device, deviceType: config.deviceType, capturedAt: config.createdAt, filename: config.filename, facts }];
    });
}

export function buildNetworkInventoryAppendix(input: {
  generatedAt: string;
  switches: any[];
  nodes: any[];
  vlans: any[];
  links: any[];
  ports: any[];
  routing: any[];
  phoneAssignments: any[];
  configFacts: any[];
}): string {
  const nodeById = new Map(input.nodes.map((node) => [String(node.id), node]));
  const portsByNode = new Map<string, any[]>();
  for (const port of input.ports) {
    const key = String(port.nodeId);
    if (!portsByNode.has(key)) portsByNode.set(key, []);
    portsByNode.get(key)!.push(port);
  }
  const phoneCounts = new Map<string, number>();
  for (const row of input.phoneAssignments) phoneCounts.set(String(row.building), Number(row.count));
  const buildings = Array.from(new Set([
    ...input.switches.map((row) => row.building),
    ...input.nodes.map((row) => row.building),
    ...input.vlans.map((row) => row.building),
    ...phoneCounts.keys(),
  ].filter(Boolean).map(String))).sort();

  const out: string[] = [
    "\n\n# Authoritative Network Inventory Appendices",
    `Generated: ${input.generatedAt}`,
    "",
    "These appendices are generated directly from Hub records rather than summarized by the language model. A missing row is therefore detectable instead of becoming polished silence.",
    "",
    "## Completeness manifest",
    "",
    "| Dataset | Records included |",
    "| --- | ---: |",
    `| Monitored switch/device inventory | ${input.switches.length} |`,
    `| Network Map nodes | ${input.nodes.length} |`,
    `| VLAN assignments | ${input.vlans.length} |`,
    `| Reciprocal/topology links | ${input.links.length} |`,
    `| Physical Port Map interfaces | ${input.ports.length} |`,
    `| Routing adjacencies | ${input.routing.length} |`,
    `| Building phone assignments | ${input.phoneAssignments.reduce((sum, row) => sum + Number(row.count), 0)} |`,
    `| Latest device configurations analyzed | ${input.configFacts.length} |`,
    "",
    "## Building service inventory",
    "",
    "| Building | Monitored objects | Map nodes | VLANs | Physical ports | Up | Down | Connected evidence | Assigned phones |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const building of buildings) {
    const switches = input.switches.filter((row) => row.building === building);
    const nodes = input.nodes.filter((row) => row.building === building);
    const ports = nodes.flatMap((node) => portsByNode.get(String(node.id)) ?? []);
    out.push(`| ${cell(building)} | ${switches.length} | ${nodes.length} | ${input.vlans.filter((row) => row.building === building).length} | ${ports.length} | ${ports.filter((p) => p.operStatus === "up").length} | ${ports.filter((p) => p.operStatus === "down").length} | ${ports.filter((p) => Number(p.macCount) > 0 || Number(p.lldpNeighborCount) > 0).length} | ${phoneCounts.get(building) ?? 0} |`);
  }

  out.push("", "## Complete monitored device inventory", "", "| Hostname | Building | IP | Model | Status | Location | Last seen |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of [...input.switches].sort((a, b) => String(a.building).localeCompare(String(b.building)) || String(a.hostname).localeCompare(String(b.hostname)))) {
    out.push(`| ${cell(row.hostname)} | ${cell(row.building)} | ${cell(row.ipAddress)} | ${cell(row.model)} | ${cell(row.status)} | ${cell(row.location)} | ${cell(row.lastSeen)} |`);
  }

  out.push("", "## Complete VLAN inventory", "", "| Building | VLAN | Name | Type | Subnet | Gateway | Description |", "| --- | ---: | --- | --- | --- | --- | --- |");
  for (const row of [...input.vlans].sort((a, b) => String(a.building).localeCompare(String(b.building)) || Number(a.vlanId) - Number(b.vlanId))) {
    out.push(`| ${cell(row.building)} | ${cell(row.vlanId)} | ${cell(row.name)} | ${cell(row.type)} | ${cell(row.subnet)} | ${cell(row.gateway)} | ${cell(row.description)} |`);
  }

  out.push("", "## Complete reciprocal link and port map", "", "| A device | A port | B device | B port | Kind | Speed Mbps | Mode | VLANs | Confidence | Last verified |", "| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |");
  for (const link of input.links) {
    const a = nodeById.get(String(link.aNodeId));
    const b = nodeById.get(String(link.bNodeId));
    out.push(`| ${cell(a?.hostname ?? link.aNodeId)} | ${cell(link.aPort)} | ${cell(b?.hostname ?? link.bNodeId)} | ${cell(link.bPort)} | ${cell(link.linkKind)} | ${cell(link.speedMbps)} | ${cell(link.portMode)} | ${cell(link.allowedVlans)} | ${cell(link.confidence)} | ${cell(link.lastVerifiedAt)} |`);
  }

  out.push("", "## Complete routing adjacency inventory", "", "| Device | Protocol | Process/area | Local interface/IP | Peer router/IP | State | Last seen | Evidence |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of input.routing) {
    const node = nodeById.get(String(row.deviceNodeId));
    out.push(`| ${cell(node?.hostname ?? row.deviceNodeId)} | ${cell(row.protocol)} | ${cell([row.process, row.area].filter(Boolean).join("/"))} | ${cell([row.localInterface, row.localIp].filter(Boolean).join(" / "))} | ${cell([row.peerRouterId, row.peerIp].filter(Boolean).join(" / "))} | ${cell(row.state)} | ${cell(row.lastSeenAt)} | ${cell(row.evidenceRef)} |`);
  }

  out.push("", "## Routing, VRF, and firewall configuration evidence", "");
  for (const config of input.configFacts) {
    out.push(`### ${cell(config.device)} (${cell(config.deviceType)})`, `Source: ${cell(config.filename)}, captured ${cell(config.capturedAt)}`, "", "```text", ...(config.facts.length ? config.facts : ["No routing/VRF lines extracted from the latest stored configuration."]), "```", "");
  }

  out.push("## Complete physical Port Map", "", "Each block contains every physical interface stored for that node, including unused/down ports.", "");
  for (const node of [...input.nodes].sort((a, b) => String(a.building).localeCompare(String(b.building)) || String(a.hostname).localeCompare(String(b.hostname)))) {
    const ports = (portsByNode.get(String(node.id)) ?? []).sort((a, b) => String(a.interfaceName).localeCompare(String(b.interfaceName), undefined, { numeric: true }));
    if (!ports.length) continue;
    out.push(`### ${cell(node.hostname)} — ${cell(node.building)} (${ports.length} physical ports)`, "", "```text", "Interface | Admin | Oper | Description | Mode | Native | Allowed | Po/vPC | MACs | LLDP | In/Out errors | Util% | Telemetry");
    for (const port of ports) {
      out.push([port.interfaceName, port.adminStatus, port.operStatus, port.description, port.portMode, port.nativeVlan, Array.isArray(port.allowedVlans) ? port.allowedVlans.join(",") : port.allowedVlans, [port.portchannel, port.vpcId].filter(Boolean).join("/"), port.macCount, port.lldpNeighborCount, `${port.inErrors ?? 0}/${port.outErrors ?? 0}`, port.utilizationPct, port.telemetryUpdatedAt].map(cell).join(" | "));
    }
    out.push("```", "");
  }
  return out.join("\n");
}
