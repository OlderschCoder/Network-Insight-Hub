#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $env:ProgramData 'SCCC\Diagnostics\config.json'),
    [switch]$Once,
    [switch]$ValidateOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Sccc.Diagnostics.psm1') -Force
$config = Read-DiagnosticsConfig -Path $ConfigPath
if ($ValidateOnly) {
    [pscustomobject]@{ Valid = $true; DeviceId = $config.DeviceId; Computer = $env:COMPUTERNAME; ServerOrigin = $config.ServerOrigin }
    exit 0
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -ne 'S-1-5-18') { throw 'The diagnostics agent must run as SYSTEM through its managed scheduled task.' }
$mutex = New-Object Threading.Mutex($false, 'Global\SCCC.Diagnostics.Agent.v1')
$locked = $false
$client = $null
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { exit 0 }
    $client = New-DiagnosticsHttpClient -Config $config
    do {
        try {
            $presence = Get-DiagnosticsPresence -Config $config
            $response = Invoke-DiagnosticsJson -Client $client -Origin $config.ServerOrigin -Path '/agent/check-in' -Body $presence
            if ($response.job) {
                $result = Invoke-DiagnosticsMeasurement -Client $client -Origin $config.ServerOrigin -DeviceId $config.DeviceId -DeviceToken $config.DeviceToken -Job $response.job
                [void](Invoke-DiagnosticsJson -Client $client -Origin $config.ServerOrigin -Path '/agent/results' -Body $result)
            }
        } catch {
            # Never print the bearer, config object, response body, or request.
            # A failed check-in simply becomes stale on Fred. The task retries.
            Write-Warning 'Diagnostics check-in or bounded job failed; the agent will retry.'
            if ($Once) { exit 1 }
        }
        if (-not $Once) { Start-Sleep -Seconds (60 + (Get-Random -Minimum 0 -Maximum 11)) }
    } while (-not $Once)
} finally {
    if ($client) { $client.Dispose() }
    $config.DeviceToken = $null
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
