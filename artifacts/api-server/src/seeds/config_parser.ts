/**
 * Network device config parser — Aruba CX and Cisco IOS.
 * Extracts VLANs, interfaces, SVI IPs, management IP, and building metadata.
 * Used by import_device_configs.ts to auto-populate switch and VLAN records.
 */

export type ParsedVlan = {
  vlanId: number;
  name: string;
  description: string | null;
  subnet: string | null;      // CIDR from SVI, e.g. "10.70.34.0/24"
  gateway: string | null;     // First IP on SVI = gateway
  type: "voice" | "management" | "infrastructure" | "user";
  isVoice: boolean;
};

export type ParsedPort = {
  interfaceName: string;
  description: string | null;
  isPhysical: boolean;
  adminStatus: "up" | "down" | null;
  speedMbps: number | null;
  portMode: "trunk" | "access" | "routed" | "peerlink" | "heartbeat" | "unknown";
  nativeVlan: number | null;
  allowedVlans: number[] | null;
  portchannel: string | null;
  vpcId: number | null;
};

export type ParsedSwitch = {
  hostname: string;
  building: string;
  buildingCode: string;
  ipAddress: string;           // Management IP
  model: string | null;
  firmwareVersion: string | null;
  format: "aruba-cx" | "cisco-ios" | "unknown";
  vlans: ParsedVlan[];
  ports: ParsedPort[];
};

// ── Strip terminal artifacts ─────────────────────────────────────────────────

export function cleanConfig(raw: string): string {
  return raw
    .replace(/^=~=~=.*?=~=~=[^\n]*/gm, "")           // PuTTY header
    .replace(/^ -- MORE --[^\n]*/gm, "")               // PuTTY pagination
    .replace(/^sho\s+runn?i?n?g?-?config[^\n]*/im, "") // show running-config command
    .replace(/Building configuration\.\.\.[^\n]*/g, "")
    .replace(/Current configuration.*bytes[^\n]*/g, "")
    .replace(/\r/g, "")
    .trim();
}

// ── Format detection ─────────────────────────────────────────────────────────

function detectFormat(content: string): "aruba-cx" | "cisco-ios" | "unknown" {
  if (/ArubaOS-CX|aoscx/i.test(content)) return "aruba-cx";
  if (/Cisco IOS|USD\d+|IOS Software|NX-OS/i.test(content)) return "cisco-ios";
  // Aruba CX uses "interface 1/1/x" style
  if (/interface \d+\/\d+\/\d+/.test(content)) return "aruba-cx";
  // Cisco uses "interface GigabitEthernetX/X"
  if (/interface GigabitEthernet|interface FastEthernet/.test(content)) return "cisco-ios";
  return "unknown";
}

// ── Building mapping ─────────────────────────────────────────────────────────

const BUILDING_MAP: Record<string, string> = {
  aa:          "Hobble",
  slc:         "Student Life Center",
  scc:         "Student Community Center",
  h:           "Health Sciences",
  m:           "Maintenance",
  a:           "Hobble",
  t:           "Technology",
  ta:          "Technology A",
  tb:          "Technology B",
  td:          "Technology D",
  tt:          "Technology T",
  slf:         "Student Life F",
  slg:         "Student Life G",
  slh:         "Student Life H",
  slj:         "Student Life J",
  slr:         "Student Life R",
  sls:         "Student Life S",
  slt:         "Student Life T",
  slab:        "Student Life AB",
  slcab:       "Student Life AB",
  slcde:       "Student Life DE",
  b:           "Business",
  cos:         "Cosmetology",
  su:          "Student Union",
  sa:          "Sports & Activities",
  softballpb:  "Softball Press Box",
  healthcenter:"Health Center",
  a144:        "Hobble",
  a161:        "Hobble",
};

export function buildingFromHostname(hostname: string): { building: string; code: string } {
  // Normalize: lowercase, strip common prefixes
  const h = hostname.toLowerCase().replace(/^(sw-|swa-|swb-)/, "");
  // Try longest match first
  const keys = Object.keys(BUILDING_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (h.startsWith(key)) {
      return { building: BUILDING_MAP[key], code: key.toUpperCase() };
    }
  }
  // Fall back to first segment before digits
  const seg = h.replace(/[0-9].*$/, "").replace(/-.*$/, "");
  return { building: seg.toUpperCase() + " Building", code: seg.toUpperCase() };
}

// ── VLAN type inference ──────────────────────────────────────────────────────

function inferVlanType(vlanId: number, name: string, isVoice: boolean): ParsedVlan["type"] {
  if (isVoice) return "voice";
  const n = name.toLowerCase();
  if (n.includes("mgmt") || n.includes("management") || vlanId === 1) return "management";
  if (
    n.includes("server") || n.includes("ap") || n.includes("aruba") ||
    n.includes("wireless") || n.includes("printer") || n.includes("sign") ||
    n.includes("iot") || n.includes("projector") || n.includes("ospf") ||
    n.includes("psec") || n.includes("infra")
  ) return "infrastructure";
  return "user";
}

// ── CIDR helpers ─────────────────────────────────────────────────────────────

function prefixToMask(prefix: number): string {
  const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return [(mask >>> 24) & 0xFF, (mask >>> 16) & 0xFF, (mask >>> 8) & 0xFF, mask & 0xFF].join(".");
}

function maskToPrefix(mask: string): number {
  return mask.split(".").reduce((acc, octet) => {
    const n = parseInt(octet, 10);
    let bits = 0;
    for (let i = 7; i >= 0; i--) { if (n & (1 << i)) bits++; else break; }
    return acc + bits;
  }, 0);
}

function networkFromCidr(cidr: string): string {
  const [ip, prefix] = cidr.split("/");
  const parts = ip.split(".").map(Number);
  const pfx = parseInt(prefix, 10);
  const mask = (0xFFFFFFFF << (32 - pfx)) >>> 0;
  const ipInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const net = (ipInt & mask) >>> 0;
  return `${(net >>> 24) & 0xFF}.${(net >>> 16) & 0xFF}.${(net >>> 8) & 0xFF}.${net & 0xFF}/${pfx}`;
}

function expandVlanList(raw: string): number[] {
  const values = new Set<number>();
  for (const token of raw.replace(/\s+/g, "").split(",")) {
    if (!token) continue;
    const range = /^(\d+)-(\d+)$/.exec(token);
    if (range) {
      const start = Math.max(1, parseInt(range[1], 10));
      const end = Math.min(4094, parseInt(range[2], 10));
      for (let vlan = start; vlan <= end; vlan++) values.add(vlan);
      continue;
    }
    const vlan = parseInt(token, 10);
    if (vlan >= 1 && vlan <= 4094) values.add(vlan);
  }
  return [...values].sort((a, b) => a - b);
}

function isPhysicalInterface(name: string): boolean {
  return /^(?:ethernet|eth|gigabitethernet|gi|fastethernet|fa|tengigabitethernet|te|twentyfivegige|tw|fortygigabitethernet|fo|hundredgig(?:e|abitethernet)|hu|\d+\/\d+\/\d+)/i.test(name);
}

function canonicalInterfaceName(raw: string): string {
  return raw.trim()
    .replace(/^HundredGig(?:abitEthernet|E)/i, "Hu")
    .replace(/^FortyGigabitEthernet/i, "Fo")
    .replace(/^TwentyFiveGigE/i, "Tw")
    .replace(/^TenGigabitEthernet/i, "Te")
    .replace(/^GigabitEthernet/i, "Gi")
    .replace(/^FastEthernet/i, "Fa")
    .replace(/^Ethernet/i, "Eth")
    .replace(/^Port-channel/i, "Po")
    .replace(/\s+/g, "");
}

function parseInterfaceBlocks(content: string, format: "aruba-cx" | "cisco-ios"): ParsedPort[] {
  const lines = content.split("\n");
  const ports: ParsedPort[] = [];
  const portchannelVpc = new Map<string, { vpcId: number | null; mode: ParsedPort["portMode"] }>();

  for (let i = 0; i < lines.length; i++) {
    const start = /^interface\s+(.+?)\s*$/i.exec(lines[i].trim());
    if (!start) continue;
    const interfaceName = canonicalInterfaceName(start[1]);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const trimmed = lines[j].trim();
      if (/^interface\s+/i.test(trimmed)) break;
      if (format === "cisco-ios" && trimmed === "!") break;
      if (format === "aruba-cx" && /^(?:vlan\s+\d+|router\s+|vrf\s+|hostname\s+)/i.test(trimmed)) break;
      body.push(trimmed);
    }
    i = Math.max(i, j - 1);

    const text = body.join("\n");
    const description = /^description\s+(.+)$/im.exec(text)?.[1]?.trim() ?? null;
    const explicitlyDown = /^shutdown$/im.test(text) && !/^no shutdown$/im.test(text);
    const explicitlyUp = /^no shutdown$/im.test(text);
    const adminStatus = explicitlyDown ? "down" : explicitlyUp ? "up" : null;
    const accessVlan = parseInt(/^(?:switchport access vlan|vlan access)\s+(\d+)/im.exec(text)?.[1] ?? "", 10);
    const nativeVlan = parseInt(/^(?:switchport trunk native vlan|vlan trunk native)\s+(\d+)/im.exec(text)?.[1] ?? "", 10);
    const allowedRaw = /^(?:switchport trunk allowed vlan(?:\s+add)?|vlan trunk allowed)\s+(.+)$/im.exec(text)?.[1] ?? "";
    const channelId = /^(?:channel-group|lag)\s+(\d+)/im.exec(text)?.[1] ?? null;
    const portchannel = channelId ? `Po${channelId}` : null;
    const vpcIdRaw = /^vpc\s+(\d+)/im.exec(text)?.[1] ?? null;
    const isPeerLink = /^vpc peer-link$/im.test(text);
    const isHeartbeat = /peer[- ]keepalive|heartbeat/i.test(interfaceName + "\n" + text);
    const isRouted = /^no switchport$/im.test(text) || /^ip address\s+/im.test(text);
    let portMode: ParsedPort["portMode"] = "unknown";
    if (isPeerLink) portMode = "peerlink";
    else if (isHeartbeat) portMode = "heartbeat";
    else if (isRouted) portMode = "routed";
    else if (/^(?:switchport mode trunk|vlan trunk allowed)/im.test(text) || allowedRaw) portMode = "trunk";
    else if (/^(?:switchport mode access|vlan access)/im.test(text) || Number.isFinite(accessVlan)) portMode = "access";

    const speedRaw = /^speed\s+(\d+)/im.exec(text)?.[1] ?? null;
    const speedMbps = speedRaw ? parseInt(speedRaw, 10) : null;
    const parsed: ParsedPort = {
      interfaceName,
      description,
      isPhysical: isPhysicalInterface(interfaceName),
      adminStatus,
      speedMbps: speedMbps && speedMbps > 0 ? speedMbps : null,
      portMode,
      nativeVlan: Number.isFinite(nativeVlan) ? nativeVlan : Number.isFinite(accessVlan) ? accessVlan : null,
      allowedVlans: allowedRaw ? expandVlanList(allowedRaw) : Number.isFinite(accessVlan) ? [accessVlan] : null,
      portchannel,
      vpcId: vpcIdRaw ? parseInt(vpcIdRaw, 10) : null,
    };
    ports.push(parsed);

    const poMatch = /^(?:port-channel|po)(\d+)$/i.exec(interfaceName.replace(/\s+/g, ""));
    if (poMatch) portchannelVpc.set(`po${poMatch[1]}`, { vpcId: parsed.vpcId, mode: parsed.portMode });
  }

  for (const port of ports) {
    if (!port.portchannel) continue;
    const aggregate = portchannelVpc.get(port.portchannel.toLowerCase());
    if (!aggregate) continue;
    if (port.vpcId == null) port.vpcId = aggregate.vpcId;
    if (aggregate.mode === "peerlink") port.portMode = "peerlink";
  }
  return ports;
}

// ── Aruba CX parser ──────────────────────────────────────────────────────────

function parseArubaCX(content: string): Omit<ParsedSwitch, "building" | "buildingCode"> {
  const lines = content.split("\n");
  const hostname = (/^hostname\s+(\S+)/m.exec(content)?.[1] ?? "unknown").trim();

  const firmwareMatch = /Version\s+([\w\-.]+)/i.exec(content);
  const firmwareVersion = firmwareMatch ? firmwareMatch[1] : null;

  // Model from VSF member type or product
  const modelMatch = /type\s+(jl\d+[a-z]?)/i.exec(content);
  const model = modelMatch ? modelMatch[1].toUpperCase() : null;

  // Management IP from "interface mgmt" block
  let ipAddress = "";
  const mgmtMatch = /interface mgmt[\s\S]*?ip static\s+([\d.]+\/\d+)/i.exec(content);
  if (mgmtMatch) {
    ipAddress = mgmtMatch[1].split("/")[0];
  }
  // Fallback: first SVI IP
  if (!ipAddress) {
    const sviIp = /interface vlan \d+[\s\S]*?ip address\s+([\d.]+)\/\d+/i.exec(content);
    if (sviIp) ipAddress = sviIp[1];
  }

  // Parse VLANs — multi-line blocks
  const vlanMap = new Map<number, Partial<ParsedVlan>>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim().replace(/-- MORE --[^\n]*/g, "").trim();

    // VLAN definition block
    const vlanDef = /^vlan (\d+)$/.exec(line);
    if (vlanDef) {
      const id = parseInt(vlanDef[1], 10);
      if (!vlanMap.has(id)) vlanMap.set(id, { vlanId: id, isVoice: false });
      const v = vlanMap.get(id)!;
      // Scan forward for name/voice within this block
      let j = i + 1;
      while (j < lines.length) {
        const inner = lines[j].trim().replace(/-- MORE --[^\n]*/g, "").trim();
        if (/^vlan \d+$/.test(inner) || /^interface/.test(inner) || inner === "!" || (inner && !inner.startsWith(" ") && !/^\s/.test(lines[j]))) break;
        const nameM = /^name\s+(.+)/.exec(inner);
        if (nameM) v.name = nameM[1].trim();
        if (/^voice$/.test(inner)) v.isVoice = true;
        const descM = /^description\s+(.+)/.exec(inner);
        if (descM && !v.description) v.description = descM[1].trim();
        j++;
      }
      i = j;
      continue;
    }

    // interface vlan X — extract SVI IP + description
    const sviM = /^interface vlan (\d+)$/i.exec(line);
    if (sviM) {
      const id = parseInt(sviM[1], 10);
      if (!vlanMap.has(id)) vlanMap.set(id, { vlanId: id, isVoice: false });
      const v = vlanMap.get(id)!;
      let j = i + 1;
      while (j < lines.length) {
        const inner = lines[j].trim().replace(/-- MORE --[^\n]*/g, "").trim();
        if (/^interface/.test(inner) || inner === "!") break;
        const ipM = /^ip address\s+([\d.]+)\/(\d+)/.exec(inner);
        if (ipM) {
          v.gateway = ipM[1];
          v.subnet = networkFromCidr(`${ipM[1]}/${ipM[2]}`);
        }
        const descM = /^description\s+(.+)/.exec(inner);
        if (descM && !v.description) v.description = descM[1].trim();
        j++;
      }
      i = j;
      continue;
    }

    i++;
  }

  const vlans: ParsedVlan[] = [];
  for (const [id, partial] of vlanMap) {
    if (id === 0) continue;
    const name = partial.name || `VLAN${id}`;
    vlans.push({
      vlanId: id,
      name,
      description: partial.description ?? null,
      subnet: partial.subnet ?? null,
      gateway: partial.gateway ?? null,
      isVoice: partial.isVoice ?? false,
      type: inferVlanType(id, name, partial.isVoice ?? false),
    });
  }

  return { hostname, model, firmwareVersion, format: "aruba-cx", ipAddress, vlans, ports: parseInterfaceBlocks(content, "aruba-cx") };
}

// ── Cisco IOS parser ─────────────────────────────────────────────────────────

function parseCiscoIOS(content: string): Omit<ParsedSwitch, "building" | "buildingCode"> {
  const lines = content.split("\n");
  const hostname = (/^hostname\s+(\S+)/m.exec(content)?.[1] ?? "unknown").trim();

  const modelMatch = /\b(USD\d+|WS-C[\w-]+|C9\d+[\w-]*)\b/i.exec(content);
  const model = modelMatch ? modelMatch[1] : null;

  const fwMatch = /Version\s+([\d.(\w)]+)/i.exec(content);
  const firmwareVersion = fwMatch ? fwMatch[1] : null;

  // Mgmt IP from interface Vlan1 or loopback or FastEthernet1
  let ipAddress = "";
  const lo = /interface Loopback\d+[\s\S]*?ip address ([\d.]+) /i.exec(content);
  if (lo) ipAddress = lo[1];
  if (!ipAddress) {
    const mgmt = /interface FastEthernet1[\s\S]*?ip address ([\d.]+) /i.exec(content);
    if (mgmt) ipAddress = mgmt[1];
  }

  const vlanMap = new Map<number, Partial<ParsedVlan>>();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // vlan X (Cisco IOS VLAN database style)
    const vlanDef = /^vlan (\d+)$/.exec(line);
    if (vlanDef) {
      const id = parseInt(vlanDef[1], 10);
      if (!vlanMap.has(id)) vlanMap.set(id, { vlanId: id, isVoice: false });
      const v = vlanMap.get(id)!;
      let j = i + 1;
      while (j < lines.length) {
        const inner = lines[j].trim();
        if (!inner.startsWith(" ") && inner && !/^$/.test(inner)) break;
        const nameM = /^\s*name\s+(.+)/.exec(lines[j]);
        if (nameM) v.name = nameM[1].trim();
        j++;
      }
      i = j;
      continue;
    }

    // interface VlanX — SVI IP
    const sviM = /^interface Vlan(\d+)$/i.exec(line);
    if (sviM) {
      const id = parseInt(sviM[1], 10);
      if (!vlanMap.has(id)) vlanMap.set(id, { vlanId: id, isVoice: false });
      const v = vlanMap.get(id)!;
      let j = i + 1;
      while (j < lines.length) {
        const inner = lines[j];
        if (/^interface|^!/.test(inner.trim()) && inner.trim().length > 1) break;
        const ipM = /ip address ([\d.]+) ([\d.]+)/.exec(inner);
        if (ipM) {
          v.gateway = ipM[1];
          const prefix = maskToPrefix(ipM[2]);
          v.subnet = networkFromCidr(`${ipM[1]}/${prefix}`);
        }
        const descM = /description\s+(.+)/.exec(inner);
        if (descM && !v.description) v.description = descM[1].trim();
        j++;
      }
      i = j;
      continue;
    }

    i++;
  }

  const vlans: ParsedVlan[] = [];
  for (const [id, partial] of vlanMap) {
    if (id === 0) continue;
    const name = partial.name || `VLAN${id}`;
    vlans.push({
      vlanId: id,
      name,
      description: partial.description ?? null,
      subnet: partial.subnet ?? null,
      gateway: partial.gateway ?? null,
      isVoice: partial.isVoice ?? false,
      type: inferVlanType(id, name, partial.isVoice ?? false),
    });
  }

  return { hostname, model, firmwareVersion, format: "cisco-ios", ipAddress, vlans, ports: parseInterfaceBlocks(content, "cisco-ios") };
}

// ── Main export ──────────────────────────────────────────────────────────────

export function parseDeviceConfig(raw: string): ParsedSwitch {
  const content = cleanConfig(raw);
  const format = detectFormat(content);

  const parsed = format === "cisco-ios" ? parseCiscoIOS(content) : parseArubaCX(content);
  const { building, code } = buildingFromHostname(parsed.hostname);

  return {
    ...parsed,
    format,
    building,
    buildingCode: code,
    ipAddress: parsed.ipAddress || "0.0.0.0",
  };
}
