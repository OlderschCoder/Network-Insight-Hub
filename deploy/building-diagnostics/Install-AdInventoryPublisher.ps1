#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ProvisioningFile,
      [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$SignerThumbprint,
      [switch]$Activate)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Join-Path $env:ProgramData 'SCCC-DiagnosticsPublisher'
if ($env:COMPUTERNAME -ine 'LP-AA152MB-01') { throw 'This publisher pilot is restricted to LP-AA152MB-01.' }
$trusted=@('S-1-5-18','S-1-5-32-544')
function Protect-Path([string]$Path,[bool]$Directory) {
    $acl=if($Directory){New-Object Security.AccessControl.DirectorySecurity}else{New-Object Security.AccessControl.FileSecurity}
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
    foreach($sid in $trusted){
        $identity=New-Object Security.Principal.SecurityIdentifier($sid)
        $rule=if($Directory){New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')}
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
function Assert-Private([string]$Path) {
    $cursor=[IO.Path]::GetFullPath($Path)
    while($cursor){
        if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse path refused.'}}
        $parent=Split-Path -Parent $cursor
        if($parent -eq $cursor){break}; $cursor=$parent
    }
    if(Test-Path -LiteralPath $Path){
        $acl=Get-Acl -LiteralPath $Path
        if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw 'Untrusted publisher owner.'}
        foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
            if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted){throw 'Publisher path must be private.'}
        }
    }
}
Assert-Private $ProvisioningFile
Assert-Private (Split-Path -Parent ([IO.Path]::GetFullPath($ProvisioningFile)))
$taskName='SCCC Diagnostics AD Inventory'
if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){throw 'Publisher task already exists.'}
$inputConfig=Get-Content -Raw -LiteralPath $ProvisioningFile | ConvertFrom-Json
if($inputConfig.fredOrigin -cne 'https://insights.sccc.edu' -or $inputConfig.workerToken -notmatch '^[A-Za-z0-9_-]{64}$'){throw 'Invalid dedicated publisher configuration.'}
$files=@('Export-AdDiagnosticsInventory.ps1','Invoke-AdInventoryPublisher.ps1')
foreach($name in $files){
    $source=Join-Path $PSScriptRoot $name
    $signature=Get-AuthenticodeSignature -LiteralPath $source
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $SignerThumbprint -or -not $signature.TimeStamperCertificate){throw 'Publisher signature/pin/timestamp validation failed.'}
}
Assert-Private $root
if(Test-Path -LiteralPath (Join-Path $root 'config.json')){throw 'Publisher already configured; review credential rotation separately.'}
if(-not(Test-Path -LiteralPath $root)){New-Item -ItemType Directory -Path $root | Out-Null};Protect-Path $root $true
foreach($name in $files){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $root $name)}
foreach($name in $files){
    $signature=Get-AuthenticodeSignature -LiteralPath (Join-Path $root $name)
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $SignerThumbprint -or -not $signature.TimeStamperCertificate){throw 'Installed publisher signature validation failed.'}
}
Add-Type -AssemblyName System.Security
$credentialPath=Join-Path $root 'worker.dpapi'
[IO.File]::WriteAllBytes($credentialPath,[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes([string]$inputConfig.workerToken),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine))
Protect-Path $credentialPath $false
$config=@{fredOrigin=$inputConfig.fredOrigin;signerThumbprint=$SignerThumbprint;searchBase='OU=SC-Computers,DC=sccc,DC=edu'}
[IO.File]::WriteAllText((Join-Path $root 'config.json'),($config | ConvertTo-Json -Compress))
$exe=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action=New-ScheduledTaskAction -Execute $exe -Argument '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy AllSigned -File "C:\ProgramData\SCCC-DiagnosticsPublisher\Invoke-AdInventoryPublisher.ps1"'
$triggers=@((New-ScheduledTaskTrigger -AtStartup),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)))
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -StartWhenAvailable
$null=Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings
Disable-ScheduledTask -TaskName $taskName | Out-Null
if($Activate){Enable-ScheduledTask -TaskName $taskName | Out-Null;Start-ScheduledTask -TaskName $taskName}
$inputConfig=$null
Remove-Item -LiteralPath $ProvisioningFile -Force
Write-Output ('AD inventory publisher installed; active='+[bool]$Activate+'. It does not enroll computers or queue tests.')
