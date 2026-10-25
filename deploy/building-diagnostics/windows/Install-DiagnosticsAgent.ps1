#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$ProvisioningFile,
    [Parameter(Mandatory = $true)][string]$ExpectedDomain,
    [string]$SignerThumbprint,
    [switch]$Activate
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Sccc.Diagnostics.psm1') -Force
$computer = Get-CimInstance -ClassName Win32_ComputerSystem
if (-not $computer.PartOfDomain -or $computer.Domain -ine $ExpectedDomain) { throw 'This helper is only for the expected AD domain.' }
Test-DiagnosticsProtectedPath -Path $ProvisioningFile
$provisioning = Get-Content -LiteralPath $ProvisioningFile -Raw | ConvertFrom-Json
$origin = Get-DiagnosticsServerOrigin -ServerUrl $provisioning.serverUrl
$deviceId = [Guid]::Parse($provisioning.deviceId).ToString()
if ($provisioning.computerName -ine $computer.Name) { throw 'Provisioning record belongs to another computer.' }
if ($provisioning.domain -ine $ExpectedDomain) { throw 'Provisioning domain does not match.' }
$token = [string]$provisioning.deviceToken
if ($token -cnotmatch '^sccc-diag\.[A-Za-z0-9_-]{43}$') { throw 'Invalid independent diagnostics credential.' }
$sourceFiles = @('Sccc.Diagnostics.psm1', 'Invoke-DiagnosticsAgent.ps1', 'ExternalProbe.dll')
foreach ($name in $sourceFiles) { if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw 'The complete reviewed diagnostics release is required, including ExternalProbe.dll.' } }
$externalOrigin = ''
$permitSustained = $false
if ($provisioning.PSObject.Properties['externalProbeOrigin'] -and $provisioning.externalProbeOrigin) { $externalOrigin = Get-DiagnosticsServerOrigin -ServerUrl ([string]$provisioning.externalProbeOrigin); if (-not ([Uri]$externalOrigin).IsDefaultPort) { throw 'External probe requires HTTPS port 443.' } }
if ($provisioning.PSObject.Properties['permitSustained']) {
    if ($provisioning.permitSustained -isnot [bool]) { throw 'permitSustained must be an explicit boolean.' }
    $permitSustained = $provisioning.permitSustained
}
if ($permitSustained -and -not $externalOrigin) { throw 'Sustained permission requires the protected external origin.' }
if ($Activate) {
    if ($SignerThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Activation requires the approved SCCC signing-certificate thumbprint.' }
    foreach ($name in $sourceFiles) {
        $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $PSScriptRoot $name)
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $SignerThumbprint) {
            throw 'Activation requires trusted Authenticode signatures on both diagnostics scripts.'
        }
    }
}
$destination = Join-Path $env:ProgramData 'SCCC\Diagnostics'
if (-not $PSCmdlet.ShouldProcess($destination, 'Stage diagnostics files and protected configuration; optionally activate its task')) { return }
if (Get-ScheduledTask -TaskName 'SCCC Building Diagnostics' -ErrorAction SilentlyContinue) {
    throw 'Diagnostics task already exists. Use the documented rollback/update procedure before replacing it.'
}
$parent = Split-Path -Parent $destination
if (-not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent) }
Test-DiagnosticsParentPath -Path $parent
if (Test-Path -LiteralPath $destination) { throw 'Diagnostics directory already exists; preserve it for explicit review.' }
[void](New-Item -ItemType Directory -Path $destination)
Set-DiagnosticsProtectedAcl -Path $destination -Directory
foreach ($name in $sourceFiles) {
    $target = Join-Path $destination $name
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $target
    Set-DiagnosticsProtectedAcl -Path $target
    if ($Activate) {
        $signature = Get-AuthenticodeSignature -LiteralPath $target
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $SignerThumbprint) { throw 'Installed diagnostics script signature does not match the approved signer.' }
    }
}
Add-Type -AssemblyName System.Security
$tokenBytes = [Text.Encoding]::UTF8.GetBytes($token)
try {
    $cipher = [Security.Cryptography.ProtectedData]::Protect($tokenBytes,
        [Text.Encoding]::UTF8.GetBytes('SCCC.Diagnostics.v1:' + $deviceId), [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $config = @{ schemaVersion = 1; serverUrl = $origin; deviceId = $deviceId; computerName = [string]$computer.Name;
        domain = $ExpectedDomain; protectedDeviceToken = [Convert]::ToBase64String($cipher); externalProbeOrigin = $externalOrigin; permitSustained = $permitSustained }
    $configPath = Join-Path $destination 'config.json'
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Set-DiagnosticsProtectedAcl -Path $configPath
} finally { [Array]::Clear($tokenBytes, 0, $tokenBytes.Length); $token = $null; $provisioning.deviceToken = $null }
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy AllSigned -File "' + (Join-Path $destination 'Invoke-DiagnosticsAgent.ps1') + '"'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
if (-not $Activate) { $task.Settings.Enabled = $false }
[void](Register-ScheduledTask -TaskName 'SCCC Building Diagnostics' -InputObject $task)
if ($Activate) { Start-ScheduledTask -TaskName 'SCCC Building Diagnostics' }
else { [void](Disable-ScheduledTask -TaskName 'SCCC Building Diagnostics') }
Write-Output ([pscustomobject]@{ Computer = $computer.Name; DeviceId = $deviceId; State = $(if ($Activate) { 'Activated' } else { 'Staged, task disabled' }); ConfigPath = $configPath })
# The trusted provisioner must delete its protected plaintext input after this
# script succeeds. It must never distribute that input through SYSVOL.
