#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$destination = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'SCCC\Diagnostics'))
$expected = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'SCCC\Diagnostics'))
if ($destination -cne $expected -or (Split-Path -Leaf $destination) -cne 'Diagnostics') { throw 'Unexpected diagnostics path.' }
if (-not $PSCmdlet.ShouldProcess('SCCC Building Diagnostics', 'Stop and remove only the diagnostics task and directory')) { return }
$task = Get-ScheduledTask -TaskName 'SCCC Building Diagnostics' -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName 'SCCC Building Diagnostics'
    Unregister-ScheduledTask -TaskName 'SCCC Building Diagnostics' -Confirm:$false
}
if (Test-Path -LiteralPath $destination) {
    if ((Get-Item -LiteralPath $destination -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to remove a reparse-point directory.' }
    # Refuse unexpected content instead of traversing a computed arbitrary tree.
    $allowed = @('Sccc.Diagnostics.psm1', 'Invoke-DiagnosticsAgent.ps1', 'ExternalProbe.dll', 'config.json')
    foreach ($item in Get-ChildItem -LiteralPath $destination -Force) {
        if ($item.PSIsContainer -or $item.Name -notin $allowed -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected diagnostics content; manual review required.' }
    }
    foreach ($name in $allowed) {
        $target = Join-Path $destination $name
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
    }
    Remove-Item -LiteralPath $destination
}
# Revoke this device's independent diagnostics credential centrally as well.
# This script never changes SCCCAlertReceiver, alert state, or MFA enrollment.
