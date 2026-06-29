import { logger } from "./logger";

export type AzureConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
};

export type AzureVmRecord = {
  azureResourceId: string;
  name: string;
  resourceGroup: string | null;
  subscription: string | null;
  location: string | null;
  size: string | null;
  os: string | null;
  status: string;
  privateIp: string | null;
  publicIp: string | null;
  vnet: string | null;
  subnet: string | null;
};

const ARM = "https://management.azure.com";
const API_COMPUTE = "2023-09-01";
const API_NETWORK = "2023-09-01";

export function getAzureConfig(): AzureConfig | null {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  if (!tenantId || !clientId || !clientSecret || !subscriptionId) return null;
  return { tenantId, clientId, clientSecret, subscriptionId };
}

async function getToken(cfg: AzureConfig): Promise<string> {
  const url = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: `${ARM}/.default`,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Azure auth failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Azure auth returned no access token");
  return json.access_token;
}

async function armGetAll<T>(token: string, path: string): Promise<T[]> {
  let url: string | undefined = `${ARM}${path}`;
  const out: T[] = [];
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Azure request failed (${res.status}) for ${path}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { value?: T[]; nextLink?: string };
    if (Array.isArray(json.value)) out.push(...json.value);
    url = json.nextLink;
  }
  return out;
}

function parseResourceGroup(id: string): string | null {
  const m = /\/resourceGroups\/([^/]+)/i.exec(id);
  return m ? m[1] : null;
}

function parseVnetSubnet(subnetId: string): { vnet: string | null; subnet: string | null } {
  const m = /\/virtualNetworks\/([^/]+)\/subnets\/([^/]+)/i.exec(subnetId);
  return m ? { vnet: m[1], subnet: m[2] } : { vnet: null, subnet: null };
}

function mapPowerState(instanceView: any): string {
  const statuses: any[] = instanceView?.statuses ?? [];
  const power = statuses.find((s) => typeof s?.code === "string" && s.code.startsWith("PowerState/"));
  if (!power) return "unknown";
  const code = String(power.code).split("/")[1] ?? "unknown";
  // Azure: running | stopped | deallocated | starting | stopping | deallocating
  return code;
}

type AzureNic = {
  id: string;
  properties?: {
    ipConfigurations?: {
      properties?: {
        privateIPAddress?: string;
        subnet?: { id?: string };
        publicIPAddress?: { id?: string };
      };
    }[];
  };
};

type AzurePublicIp = {
  id: string;
  properties?: { ipAddress?: string };
};

type AzureVm = {
  id: string;
  name: string;
  location?: string;
  properties?: {
    hardwareProfile?: { vmSize?: string };
    storageProfile?: {
      osDisk?: { osType?: string };
      imageReference?: { offer?: string; sku?: string };
    };
    networkProfile?: { networkInterfaces?: { id?: string }[] };
    instanceView?: any;
  };
};

export async function fetchAzureVms(cfg: AzureConfig): Promise<AzureVmRecord[]> {
  const token = await getToken(cfg);
  const sub = cfg.subscriptionId;

  // Note: $expand=instanceView is NOT supported on the subscription-wide VM
  // list (Azure 400s — it's only valid for scale sets). Power state must be
  // fetched via the same list endpoint with ?statusOnly=true, then merged.
  const [vms, statusVms, nics, publicIps] = await Promise.all([
    armGetAll<AzureVm>(
      token,
      `/subscriptions/${sub}/providers/Microsoft.Compute/virtualMachines?api-version=${API_COMPUTE}`,
    ),
    armGetAll<AzureVm>(
      token,
      `/subscriptions/${sub}/providers/Microsoft.Compute/virtualMachines?api-version=${API_COMPUTE}&statusOnly=true`,
    ),
    armGetAll<AzureNic>(
      token,
      `/subscriptions/${sub}/providers/Microsoft.Network/networkInterfaces?api-version=${API_NETWORK}`,
    ),
    armGetAll<AzurePublicIp>(
      token,
      `/subscriptions/${sub}/providers/Microsoft.Network/publicIPAddresses?api-version=${API_NETWORK}`,
    ),
  ]);

  const nicById = new Map(nics.map((n) => [n.id.toLowerCase(), n]));
  const pipById = new Map(publicIps.map((p) => [p.id.toLowerCase(), p]));
  const instanceViewById = new Map(
    statusVms.map((v) => [v.id.toLowerCase(), v.properties?.instanceView]),
  );

  return vms.map((vm) => {
    const props = vm.properties ?? {};
    let privateIp: string | null = null;
    let publicIp: string | null = null;
    let vnet: string | null = null;
    let subnet: string | null = null;

    const nicRef = props.networkProfile?.networkInterfaces?.[0]?.id;
    if (nicRef) {
      const nic = nicById.get(nicRef.toLowerCase());
      const ipCfg = nic?.properties?.ipConfigurations?.[0]?.properties;
      if (ipCfg) {
        privateIp = ipCfg.privateIPAddress ?? null;
        if (ipCfg.subnet?.id) {
          const parsed = parseVnetSubnet(ipCfg.subnet.id);
          vnet = parsed.vnet;
          subnet = parsed.subnet;
        }
        if (ipCfg.publicIPAddress?.id) {
          const pip = pipById.get(ipCfg.publicIPAddress.id.toLowerCase());
          publicIp = pip?.properties?.ipAddress ?? null;
        }
      }
    }

    const img = props.storageProfile?.imageReference;
    const osType = props.storageProfile?.osDisk?.osType ?? null;
    const os = img?.offer
      ? `${img.offer}${img.sku ? " " + img.sku : ""}`
      : osType;

    return {
      azureResourceId: vm.id,
      name: vm.name,
      resourceGroup: parseResourceGroup(vm.id),
      subscription: sub,
      location: vm.location ?? null,
      size: props.hardwareProfile?.vmSize ?? null,
      os,
      status: mapPowerState(instanceViewById.get(vm.id.toLowerCase()) ?? props.instanceView),
      privateIp,
      publicIp,
      vnet,
      subnet,
    };
  });
}

export type AzureResourceRecord = {
  azureResourceId: string;
  name: string;
  type: string;
  resourceGroup: string | null;
  location: string | null;
  kind: string | null;
  sku: string | null;
  tags: Record<string, string> | null;
  subscription: string | null;
};

type AzureGenericResource = {
  id: string;
  name: string;
  type: string;
  location?: string;
  kind?: string;
  sku?: { name?: string };
  tags?: Record<string, string>;
};

/**
 * Lists EVERY resource in the subscription (all types) via the generic ARM
 * resources endpoint. Pages through nextLink so nothing is dropped. Resource
 * group is parsed from the resource id.
 */
export async function fetchAzureResources(cfg: AzureConfig): Promise<AzureResourceRecord[]> {
  const token = await getToken(cfg);
  const sub = cfg.subscriptionId;
  const resources = await armGetAll<AzureGenericResource>(
    token,
    `/subscriptions/${sub}/resources?api-version=2021-04-01`,
  );
  return resources.map((r) => ({
    azureResourceId: r.id,
    name: r.name,
    type: r.type,
    resourceGroup: parseResourceGroup(r.id),
    location: r.location ?? null,
    kind: r.kind ?? null,
    sku: r.sku?.name ?? null,
    tags: r.tags && Object.keys(r.tags).length > 0 ? r.tags : null,
    subscription: sub,
  }));
}

export async function isAzureReachable(cfg: AzureConfig): Promise<boolean> {
  try {
    await getToken(cfg);
    return true;
  } catch (err) {
    logger.warn({ err }, "Azure reachability check failed");
    return false;
  }
}
