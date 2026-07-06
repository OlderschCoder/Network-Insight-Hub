/**
 * Network device config parser — Aruba CX and Cisco IOS.
 * Extracts VLANs, SVI IPs, management IP, and building metadata.
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

export type ParsedSwitch = {
  hostname: string;
  building: string;
  buildingCode: string;
  ipAddress: string;           // Management IP
  model: string | null;
  firmwareVersion: string | null;
  format: "aruba-cx" | "cisco-ios" | "unknown";
  vlans: ParsedVlan[];
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
  aa:          "Academic Arts",
  slc:         "Student Life Center",
  scc:         "Student Community Center",
  h:           "Health Sciences",
  m:           "Maintenance",
  a:           "Administration",
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
  a144:        "Academic Arts 144",
  a161:        "Academic Arts 161",
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

  return { hostname, model, firmwareVersion, format: "aruba-cx", ipAddress, vlans };
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

  return { hostname, model, firmwareVersion, format: "cisco-ios", ipAddress, vlans };
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
