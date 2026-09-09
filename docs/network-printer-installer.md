# Fred shared-printer installer

Fred exposes the shared-printer installer under **Network Tools > Install Printer**. Authorized network staff enter the printer name, IPv4 address, location, and comment; the driver is selected from an exact, live list of drivers registered on `prntsp2.sccc.edu`. Choosing **Create or update shared printer** performs the operation through Fred and returns the client UNC path.

Fred does not guess a Sharp model, register a driver package, or execute PowerShell in the browser. A fixed-purpose Windows bridge runs on the print server and exposes only driver-list and idempotent printer-queue operations. This is the required Windows execution boundary because Fred's API runs on Linux.

## Operator workflow

1. Open **Network Tools > Install Printer**. Fred loads the registered driver catalog from the print server.
2. Enter the printer name and IPv4 address. Location and comment are optional.
3. Filter the driver list if useful, then select the exact model/driver. A driver selection is required; blank or approximate matches are rejected.
4. Choose **Create or update shared printer**.
5. Fred verifies that the printer is reachable on TCP/9100, then creates or updates the standard TCP/IP port and shared queue. On success, copy the displayed `\\prntsp2.sccc.edu\<share>` path for clients.

If reachability, the driver lookup, port creation, queue creation, or final verification fails, Fred reports that failure and does not claim success. Driver deployment remains a separate administrator task.

## Install the restricted bridge

Copy these three reviewed files to the same temporary directory on `prntsp2.sccc.edu`:

- `scripts/print-management-bridge.ps1`
- `scripts/install-print-management-bridge.ps1`
- `scripts/test-print-management-bridge.ps1`

From an elevated Windows PowerShell session on `PRNTSP2`, run the static check and installer:

```powershell
.\test-print-management-bridge.ps1
.\install-print-management-bridge.ps1 -ListenAddress 10.0.0.30 -Port 9124 -AllowedClients 10.0.0.44 -AllowPrivateHttp
```

Use that exact address—not `+`, `*`, or `0.0.0.0`. The installer rejects wildcard and non-approved listeners, writes the generated token and settings to ACL-protected `C:\ProgramData\SCCC\FredPrinterBridge\config.json`, installs the bridge under `SYSTEM` as the `SCCC Fred Printer Bridge` startup task, and creates the `SCCC-Fred-Printer-Bridge` Windows Firewall rule. The rule permits Fred's verified private API address (`10.0.0.44`) and the print server's own address (`10.0.0.30`) used for the installer self-test. Do not add a public NAT, load-balancer rule, or broader campus source range.

The installer performs an authenticated, read-only driver-catalog request before reporting success. It does not create a printer queue.

## Configure Fred

Store the token from the bridge configuration in Fred's root-only production environment. Never display it in logs, put it on a command line, or commit it.

```dotenv
PRINT_MANAGEMENT_URL=http://10.0.0.30:9124
PRINT_MANAGEMENT_TOKEN=<long-random-service-token>
PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP=true
```

The URL and token are required. Because production uses private HTTP, the explicit private-HTTP flag is required too. If configuration is absent, invalid, or unavailable, Fred disables printer creation and reports the service error. Restart `sccc-api` after changing its environment.

The bridge defaults to loopback-only so an incomplete installation fails closed. Plain HTTP is accepted only for the fixed private print-server host, with the explicit override and the restricted Windows Firewall rule above. The token is never returned to the browser. Fred requires an authenticated `cio`, `network`, or `network_engineer` account before proxying either bridge operation.

## Validate without creating a queue

On `PRNTSP2`, confirm the task, restricted firewall sources, and authenticated driver catalog. The following keeps the token in memory and prints only the server name and driver count:

```powershell
Get-ScheduledTask -TaskName 'SCCC Fred Printer Bridge' | Get-ScheduledTaskInfo
Get-NetFirewallRule -Name 'SCCC-Fred-Printer-Bridge' | Get-NetFirewallAddressFilter
$bridgeConfig = Get-Content 'C:\ProgramData\SCCC\FredPrinterBridge\config.json' -Raw | ConvertFrom-Json
$catalog = Invoke-RestMethod -Uri 'http://10.0.0.30:9124/v1/printers/drivers' -Headers @{ Authorization = "Bearer $($bridgeConfig.token)" }
[pscustomobject]@{ PrintServer = $catalog.printServer; DriverCount = @($catalog.drivers).Count }
Remove-Variable bridgeConfig, catalog
```

Then verify that **Network Tools > Install Printer** loads the registered drivers and contains the exact required model. Confirm a non-network role receives HTTP 403. Queue creation is the final functional check: use a known, reachable RFC1918 printer and its exact registered driver, then confirm the returned UNC path plus driver, port, share, location, and comment on `prntsp2`. Do not create a disposable queue merely to prove deployment.

## Rotate the bridge token

Use a short maintenance window because Fred cannot call the bridge between rotation and its API restart. On `PRNTSP2`, rerun the same installer command with `-RotateToken`:

```powershell
.\install-print-management-bridge.ps1 -ListenAddress 10.0.0.30 -Port 9124 -AllowedClients 10.0.0.44 -AllowPrivateHttp -RotateToken
```

Move the new token from the ACL-protected configuration to Fred through the approved secret-handling path without echoing it. Replace only `PRINT_MANAGEMENT_TOKEN` in `/opt/sccc-it/.env.production`, keep the file owned by `root:root` with mode `600`, restart `sccc-api`, and repeat the read-only driver-list validation. The old token stops working as soon as the installer completes.

## Roll back the integration

To withdraw the feature without changing existing queues, first remove or comment the three `PRINT_MANAGEMENT_*` entries from Fred's production environment and restart `sccc-api`. Then run on `PRNTSP2`:

```powershell
Stop-ScheduledTask -TaskName 'SCCC Fred Printer Bridge' -ErrorAction SilentlyContinue
Disable-ScheduledTask -TaskName 'SCCC Fred Printer Bridge'
Disable-NetFirewallRule -Name 'SCCC-Fred-Printer-Bridge'
```

This disables Fred's management path; it does not delete any printer, port, driver, or ACL-protected bridge configuration. Queue removal is a separate, deliberate print-server operation. To restore service, rerun the exact installer command and revalidate before re-enabling Fred's environment settings.

## Queue behavior and the Sharp failure

Queue creation is idempotent: an existing queue is updated and a missing queue is created. A new standard TCP/IP port uses RAW TCP/9100. To disable SNMP, the bridge omits `Add-PrinterPort -SNMP`; passing `-SNMP 0` is invalid because `-SNMP` is an enabling/index parameter, which caused the earlier “one or more specified parameters ... has an invalid value” failure.

The former installer also selected the first Sharp driver when the field was blank, which could silently bind the wrong model and appear to hang while registering a package. Fred now requires an exact selection from the print server's registered drivers and never invokes `pnputil`, vendor installers, or driver-registration commands.

See [network-printer-installer-flow.mmd](network-printer-installer-flow.mmd) for the execution and trust boundaries.
