[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bridgePath = Join-Path $PSScriptRoot 'print-management-bridge.ps1'
$installerPath = Join-Path $PSScriptRoot 'install-print-management-bridge.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    $bridgePath,
    [ref]$tokens,
    [ref]$parseErrors
)

if ($parseErrors.Count -gt 0) {
    $details = ($parseErrors | ForEach-Object {
        "line $($_.Extent.StartLineNumber): $($_.Message)"
    }) -join [Environment]::NewLine
    throw "Bridge script has PowerShell syntax errors:$([Environment]::NewLine)$details"
}

$source = Get-Content -LiteralPath $bridgePath -Raw
if ($source -notmatch "\`$PrintServer\s*=\s*'prntsp2\.sccc\.edu'") {
    throw 'The bridge must keep prntsp2.sccc.edu as a fixed server-side constant.'
}
if ($source -match '-ComputerName') {
    throw 'The PRNTSP2 bridge must use local PrintManagement calls under SYSTEM, not RPC-to-self.'
}
if ($source -notmatch "COMPUTERNAME\s+-ine\s+'PRNTSP2'") {
    throw 'The bridge must fail closed when it is not running on PRNTSP2.'
}
if ($source -notmatch 'PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP' -or
    $source -notmatch '10\.0\.0\.30' -or
    $source -notmatch 'Assert-RestrictedFirewallRule') {
    throw 'Private HTTP must require the explicit override, fixed host, and restricted firewall rule.'
}
if ($source -match '(?i)ConvertTo-SecureString|PSCredential|Invoke-Expression|\biex\b') {
    throw 'The bridge must not contain credentials or dynamic command execution.'
}

$addPortCommands = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq 'Add-PrinterPort'
}, $true))
if ($addPortCommands.Count -ne 1) {
    throw "Expected exactly one Add-PrinterPort command, found $($addPortCommands.Count)."
}
foreach ($command in $addPortCommands) {
    $parameters = @($command.CommandElements | ForEach-Object { $_.Extent.Text })
    if ($parameters -contains '-SNMP') {
        throw 'Add-PrinterPort must omit -SNMP so zero is never passed as an invalid SNMP index.'
    }
}

foreach ($requiredPhase in @('validation', 'driver', 'reachability', 'port', 'queue', 'verify')) {
    if ($source -notmatch "'$requiredPhase'") {
        throw "Bridge is missing the '$requiredPhase' failure phase."
    }
}

$installerTokens = $null
$installerErrors = $null
[Management.Automation.Language.Parser]::ParseFile(
    $installerPath,
    [ref]$installerTokens,
    [ref]$installerErrors
) | Out-Null
if ($installerErrors.Count -gt 0) {
    $details = ($installerErrors | ForEach-Object {
        "line $($_.Extent.StartLineNumber): $($_.Message)"
    }) -join [Environment]::NewLine
    throw "Bridge installer has PowerShell syntax errors:$([Environment]::NewLine)$details"
}
$installerSource = Get-Content -LiteralPath $installerPath -Raw
foreach ($requiredInvariant in @(
    'C:\ProgramData\SCCC\FredPrinterBridge',
    'New-RestrictedFileAcl',
    'New-ScheduledTaskPrincipal',
    'New-NetFirewallRule'
)) {
    if (-not $installerSource.Contains($requiredInvariant)) {
        throw "Bridge installer is missing required invariant: $requiredInvariant"
    }
}
if ($installerSource -match '(?i)-Argument[^\r\n]*PRINT_MANAGEMENT_TOKEN') {
    throw 'The scheduled-task command line must never contain the bridge token.'
}

Write-Host 'Print-management bridge static validation passed.' -ForegroundColor Green
