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
    $allowed = @('Sccc.Diagnostics.psm1', 'Invoke-DiagnosticsAgent.ps1', 'ExternalProbe.dll', 'config.json', 'LibreSpeed')
    foreach ($item in Get-ChildItem -LiteralPath $destination -Force) {
        if ($item.Name -notin $allowed -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            ($item.PSIsContainer -and $item.Name -cne 'LibreSpeed')) { throw 'Unexpected diagnostics content; manual review required.' }
    }
    $libreSpeed = Join-Path $destination 'LibreSpeed'
    if (Test-Path -LiteralPath $libreSpeed) {
        if ((Get-Item -LiteralPath $libreSpeed -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to remove a reparse-point LibreSpeed directory.' }
        $libreAllowed = @('librespeed-cli.exe', 'LICENSE')
        foreach ($item in Get-ChildItem -LiteralPath $libreSpeed -Force) {
            if ($item.PSIsContainer -or $item.Name -notin $libreAllowed -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected LibreSpeed content; manual review required.' }
        }
        foreach ($name in $libreAllowed) {
            $target = Join-Path $libreSpeed $name
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
        }
        Remove-Item -LiteralPath $libreSpeed
    }
    foreach ($name in @('Sccc.Diagnostics.psm1', 'Invoke-DiagnosticsAgent.ps1', 'ExternalProbe.dll', 'config.json')) {
        $target = Join-Path $destination $name
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
    }
    Remove-Item -LiteralPath $destination
}
# Revoke this device's independent diagnostics credential centrally as well.
# This script never changes SCCCAlertReceiver, alert state, or MFA enrollment.
