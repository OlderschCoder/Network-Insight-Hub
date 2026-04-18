# Azure export for visualization (CLI + PowerShell)

**Repo context:** These exports feed **cloud half** of hybrid diagrams and **Azure security** analysis; combine with **`NETWORK_OVERVIEW.md`** (FortiGate alignment) and **`INDEX.md`** (full documentation map).

## Primary: `azure_visualizer.ps1`

**Location:** `c:\Code\Aruba\azure_visualizer.ps1`

Runs **read-only** `az` commands and writes **one file per call** under a timestamped folder **`azure-export-YYYYMMDD-HHmmss`**, UTF-8, ready to **zip and upload**.

### Prerequisites

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and on `PATH`
- `az login` completed
- Optional: `az extension add --name resource-graph` (enables Resource Graph exports **50–53**)

### Usage (PowerShell)

```powershell
cd c:\Code\Aruba

# Current subscription (from az account)
.\azure_visualizer.ps1

# Specific subscription
.\azure_visualizer.ps1 -Subscription "RG-Prod-CentralUS"   # name or GUID

# Deep export for one or more resource groups
.\azure_visualizer.ps1 -Subscription "<sub-id-or-name>" -ResourceGroup @("RG-Prod-CentralUS")

# Custom output parent folder (default: script directory)
.\azure_visualizer.ps1 -OutputRoot "D:\exports"
```

### Output bundle

| Artifact | Purpose |
|----------|---------|
| **`README.txt`** | When / where export ran |
| **`MANIFEST.txt`** | Filename + size for verification after upload |
| **`00-*` … `99-*`** | JSON/table outputs per Azure area (VNets, VMs, ASGs, NSGs, VPN, etc.) |
| **`rg-00-<name>-*.json`** | Per–resource-group exports when `-ResourceGroup` is used |

### Zip for upload

```powershell
Compress-Archive -Path ".\azure-export-20260101-120000" -DestinationPath ".\azure-export-20260101-120000.zip"
```

### After installing `resource-graph` (fills in graph exports)

If an earlier run created **`50-graph-SKIPPED.txt`**, install the extension and **re-run the script** — a **new** `azure-export-*` folder will include **`50-graph-vms.json`** … **`53-graph-nics.json`**.

```powershell
az extension add --name resource-graph   # once per machine/profile
cd c:\Code\Aruba
.\azure_visualizer.ps1                     # same flags you used before, e.g. -Subscription / -ResourceGroup
```

**Graph-only** (if you do not want a full re-export): pick an output folder and run:

```powershell
$Out = "c:\Code\Aruba\azure-export-20260417-210635"   # or a new folder
az graph query -q "Resources | where type =~ 'Microsoft.Compute/virtualMachines' | project name, resourceGroup, location, id" -o json | Out-File "$Out\50-graph-vms.json" -Encoding utf8
az graph query -q "Resources | where type =~ 'Microsoft.Network/applicationSecurityGroups' | project name, resourceGroup, location, id" -o json | Out-File "$Out\51-graph-asgs.json" -Encoding utf8
az graph query -q "Resources | where type =~ 'Microsoft.Network/virtualNetworks' | project name, resourceGroup, location, id" -o json | Out-File "$Out\52-graph-vnets.json" -Encoding utf8
az graph query -q "Resources | where type =~ 'Microsoft.Network/networkInterfaces' | project name, resourceGroup, id" -o json | Out-File "$Out\53-graph-nics.json" -Encoding utf8
```

Then delete **`50-graph-SKIPPED.txt`** if present, add the four files to your zip, and refresh **`MANIFEST.txt`** (optional).

---

## Manual commands (reference)

If you prefer individual `az` lines (bash or PowerShell), the same operations are standard Azure CLI patterns:

- `az account show`, `az group list`
- `az network vnet list`, `az network asg list`, `az network nsg list`
- `az vm list -d`, `az network vnet-gateway list`, `az network vpn-connection list`
- `az graph query` (with **resource-graph** extension)

Pipe or redirect each to your own files, e.g. `az vm list -o json | Out-File vm.json -Encoding utf8`.

---

## Related local docs

- **`NETWORK_OVERVIEW.md`** — FortiGate ↔ Azure (**Hybrid-VNet**, **OnPrem-LNG**, etc.)
