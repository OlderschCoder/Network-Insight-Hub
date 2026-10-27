#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ManifestPath, [Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedManifestSHA256,
    [Parameter(Mandatory)][Guid]$RunId, [switch]$Apply, [switch]$ApiDirectorySchemaVerified, [switch]$Publish)
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\SCCC-DiagnosticsPublisher'
$names = @('Export-AdDiagnosticsInventory.ps1', 'Invoke-AdInventoryPublisher.ps1')
$taskName = 'SCCC Diagnostics AD Inventory'
$oldSigner = '9C6F10572711B7BD83AED649B405E239A9F345B0'
$newSigner = 'A9EA8B0DC141AEC21544359FF3DFD4E9499EA177'
$baselineHashes = @{'Export-AdDiagnosticsInventory.ps1'='2195ABAEC21EDF590644718131B3C1C933AED1EFCC56EF3A471C08E2278D5093';'Invoke-AdInventoryPublisher.ps1'='671880F5137ABD141B2954A803E4FF1ADAD7AFFE45639AA66E21F21C4FD86CA1';'config.json'='83B4A6A58C2F5AE0EF1E6B3FA5936EAA59A457D5824BF65872F84FDEAD773A48'}
$candidateHashes = @{'Export-AdDiagnosticsInventory.ps1'='22AA6730E6AB9712DED857196E598BB731A0A3CAC47555F657FC6E68BAC42FF7';'Invoke-AdInventoryPublisher.ps1'='E2611DAD035CC6C16102B90D5FDD67A27992CD18F022BB6CF8318C67E040C454'}
$stage = $null; $phase = 'preflight'; $failure = $null; $mutated = $false; $disabled = $false; $verified = $false; $restored = $false; $rollback = $null; $newConfigHash = $null; $acls = @{}
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function NoLink([string]$Path) { $cursor=[IO.Path]::GetFullPath($Path); while($cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirected publisher path.'};$next=Split-Path -Parent $cursor;if($next -eq $cursor){break};$cursor=$next} }
function Private([string]$Path) { NoLink $Path; $acl=Get-Acl -LiteralPath $Path; if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Publisher owner mismatch.'};foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Publisher ACL mismatch.'}}; $acl.Sddl }
function Signed([string]$Path,[string]$ExpectedHash,[string]$Signer) { NoLink $Path; if((Hash $Path) -cne $ExpectedHash){throw 'Publisher file hash drift.'};$s=Get-AuthenticodeSignature -LiteralPath $Path;if($s.Status -ne 'Valid' -or -not $s.TimeStamperCertificate -or $s.SignerCertificate.Thumbprint -cne $Signer -or $s.SignerCertificate.Subject -notmatch '(?:^|,\s*)O=Seward County Community College(?:,|$)'){throw 'Pinned timestamped publisher signature required.'} }
function TaskHash { $text=Export-ScheduledTask -TaskName $taskName;$sha=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','')}finally{$sha.Dispose()} }
function WorkerPreserved { if((Hash (Join-Path $root 'worker.dpapi')) -cne $manifest.WorkerCiphertextSHA256 -or (Private (Join-Path $root 'worker.dpapi')) -cne $manifest.WorkerAcl){throw 'Existing protected worker credential changed; hold for review.'} }
function PublisherPolicy { $policy=Get-ExecutionPolicy -Scope MachinePolicy;if($policy -eq 'Restricted' -or (-not (Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$newSigner)) -and $policy -ne 'Unrestricted')){throw 'Current machine policy requires existing publisher trust; hold without changing policy or certificates.'} }
function ReplaceFile([string]$Source,[string]$Destination,[string]$ExpectedHash) {
    $temp=Join-Path $root ('.directory-update-'+$RunId.ToString('N')+'-'+[IO.Path]::GetFileName($Destination))
    if(Test-Path -LiteralPath $temp){throw 'Unexpected update temporary file.'}
    [IO.File]::Copy($Source,$temp,$false);Set-Acl -LiteralPath $temp -AclObject (Get-Acl -LiteralPath $Destination)
    if((Hash $temp) -cne $ExpectedHash){throw 'Protected replacement copy mismatch.'}
    [IO.File]::Replace($temp,$Destination,[NullString]::Value)
    if((Hash $Destination) -cne $ExpectedHash -or (Private $Destination) -cne $acls[[IO.Path]::GetFileName($Destination)]){throw 'Publisher replacement readback failed.'}
}
try {
    if($RunId -eq [Guid]::Empty -or $env:COMPUTERNAME -ine 'LP-F6K6S64' -or -not [Environment]::Is64BitProcess){throw 'Named publisher workstation required.'}
    if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne 'S-1-5-21-4013532473-1306839332-4181249023-66686'){throw 'Reviewed domain operator required.'}
    $system=Get-CimInstance Win32_ComputerSystem;if(-not $system.PartOfDomain -or $system.Domain -ine 'sccc.edu' -or $system.DomainRole -ne 1){throw 'Publisher domain workstation identity mismatch.'}
    Import-Module ActiveDirectory
    $ad=Get-ADComputer -Server 'ad-sc00.sccc.edu' -Identity ([Guid]'a668bbe0-81b5-4c8f-a4f0-5097a9dbe68c') -Properties Enabled,DNSHostName
    if(-not $ad.Enabled -or $ad.Name -ine 'LP-F6K6S64' -or $ad.DNSHostName -ine 'LP-F6K6S64.sccc.edu'){throw 'Pinned publisher AD object mismatch.'}
    NoLink $ManifestPath;if((Hash $ManifestPath) -ine $ExpectedManifestSHA256){throw 'Frozen update manifest mismatch.'}
    $manifest=Get-Content -LiteralPath $ManifestPath -Raw|ConvertFrom-Json
    if($manifest.schema -cne 'sccc.diagnostics.publisher-directory-update.v1' -or $manifest.ExporterSHA256 -cne $baselineHashes[$names[0]] -or $manifest.WrapperSHA256 -cne $baselineHashes[$names[1]] -or $manifest.ConfigSHA256 -cne $baselineHashes['config.json'] -or $manifest.ConfigSigner -cne $oldSigner -or $manifest.TaskName -cne $taskName -or $manifest.TaskXmlSHA256 -cne '2562DC7F25D315A3FE68C16E544BEB7B196BE7B0A2F55C0EB3C0B53742EEE1C4'){throw 'Manifest baseline is outside this reviewed update.'}
    $rootSddl=Private $root;if(-not (Get-Acl -LiteralPath $root).AreAccessRulesProtected){throw 'Publisher directory must remain protected.'}
    foreach($name in @($names)+@('config.json')){$path=Join-Path $root $name;$acls[$name]=Private $path;if((Hash $path) -cne $baselineHashes[$name]){throw 'Installed publisher baseline drift.'}}
    foreach($name in $names){Signed (Join-Path $root $name) $baselineHashes[$name] $oldSigner;Signed (Join-Path (Split-Path -Parent $ManifestPath) $name) $candidateHashes[$name] $newSigner}
    WorkerPreserved
    PublisherPolicy
    $config=Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw|ConvertFrom-Json
    if((($config.PSObject.Properties.Name|Sort-Object) -join ',') -cne 'fredOrigin,searchBase,signerThumbprint' -or $config.fredOrigin -cne 'https://insights.sccc.edu' -or $config.searchBase -cne 'OU=SC-Computers,DC=sccc,DC=edu' -or $config.signerThumbprint -cne $oldSigner){throw 'Protected nonsecret publisher configuration drift.'}
    $task=Get-ScheduledTask -TaskName $taskName
    if($task.State -ne 'Ready' -or -not $task.Settings.Enabled -or (TaskHash) -cne $manifest.TaskXmlSHA256){throw 'Publisher task is not at the reviewed idle baseline.'}
    if(-not $Apply){[pscustomobject]@{Status='ValidatedNotApplied';Computer=$env:COMPUTERNAME;Task=$taskName;CredentialsChanged=$false};return}
    if(-not $ApiDirectorySchemaVerified){throw 'Integrated API directory-schema verification is required before activation.'}
    $stage=Join-Path $root ('DirectoryUpdate-'+$RunId.ToString('N'));if(Test-Path -LiteralPath $stage){throw 'Fresh protected update stage required.'}
    [void][IO.Directory]::CreateDirectory($stage);$privateAcl=Get-Acl -LiteralPath $root;Set-Acl -LiteralPath $stage -AclObject $privateAcl;$null=Private $stage
    foreach($name in @($names)+@('config.json')){Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $stage ('before-'+$name));if((Hash (Join-Path $stage ('before-'+$name))) -cne $baselineHashes[$name]){throw 'Publisher backup mismatch.'}}
    foreach($name in $names){Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $ManifestPath) $name) -Destination (Join-Path $stage ('candidate-'+$name));Signed (Join-Path $stage ('candidate-'+$name)) $candidateHashes[$name] $newSigner}
    $config.signerThumbprint=$newSigner;$newConfig=Join-Path $stage 'candidate-config.json';[IO.File]::WriteAllText($newConfig,($config|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false));$newConfigHash=Hash $newConfig
    $phase='idle-task-fence';Disable-ScheduledTask -TaskName $taskName|Out-Null;$disabled=$true
    $scheduler=New-Object -ComObject Schedule.Service;$scheduler.Connect();try{if($scheduler.GetFolder('\').GetTask($taskName).GetInstances(0).Count -ne 0){throw 'Publisher is already executing; no file changed.'}}finally{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($scheduler)}
    WorkerPreserved;foreach($name in @($names)+@('config.json')){if((Hash (Join-Path $root $name)) -cne $baselineHashes[$name]){throw 'Publisher changed while acquiring the idle fence.'}}
    $phase='atomic-code-and-pin-update';$mutated=$true
    foreach($name in $names){ReplaceFile (Join-Path $stage ('candidate-'+$name)) (Join-Path $root $name) $candidateHashes[$name]}
    ReplaceFile $newConfig (Join-Path $root 'config.json') $newConfigHash
    foreach($name in $names){Signed (Join-Path $root $name) $candidateHashes[$name] $newSigner};WorkerPreserved;PublisherPolicy
    if((Private $root) -cne $rootSddl){throw 'Publisher directory ACL changed.'}
    # Code/config are complete before the task can run. Never roll back files
    # after re-enabling it, because a scheduled instance may already have started.
    $verified=$true;$phase='verified-code-task-restore'
    Enable-ScheduledTask -TaskName $taskName|Out-Null;$disabled=$false
    if((TaskHash) -cne $manifest.TaskXmlSHA256){throw 'Publisher task definition did not remain unchanged.'}
    $phase='updated-verified'
    if($Publish){$phase='updated-publish-requested';Start-ScheduledTask -TaskName $taskName}
} catch {
    $failure=[ordered]@{Phase=$phase;ErrorType=$_.Exception.GetType().FullName;ErrorId=[string]$_.FullyQualifiedErrorId;Line=$_.InvocationInfo.ScriptLineNumber}
    if($mutated -and -not $verified){
        try{
            foreach($name in @($names)+@('config.json')){$current=Hash (Join-Path $root $name);$allowed=@($baselineHashes[$name]);if($name -eq 'config.json'){$allowed+= $newConfigHash}else{$allowed+=$candidateHashes[$name]};if($current -notin $allowed){throw 'Unknown publisher bytes; no blind rollback.'}}
            foreach($name in @($names)+@('config.json')){ReplaceFile (Join-Path $stage ('before-'+$name)) (Join-Path $root $name) $baselineHashes[$name]};WorkerPreserved;$restored=$true;$rollback='ExactBaselineRestored'
        }catch{$rollback='HeldRequiresReview'}
    }
    if($disabled -and (-not $mutated -or $restored)){try{Enable-ScheduledTask -TaskName $taskName|Out-Null;$disabled=$false}catch{}}
    if($verified -and $phase -eq 'verified-code-task-restore'){try{Disable-ScheduledTask -TaskName $taskName|Out-Null;$disabled=$true}catch{}}
}
[pscustomobject]@{Status=if($failure){'RequiresReview'}else{$phase};Computer=$env:COMPUTERNAME;Task=$taskName;Failure=$failure;ProtectedEvidence=$stage;Rollback=$rollback;TaskHeldDisabled=$disabled;CodeVerified=$verified;CredentialsChanged=$false;DirectoryMembershipChanged=$false;MeasurementsRequested=$false;Rebooted=$false}
if($failure){exit 1}

# SIG # Begin signature block
# MII9agYJKoZIhvcNAQcCoII9WzCCPVcCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCCcCxpCdK8rXcnC
# yAQ2wysNWpz0ECT1x+TD4sf0ErnAcqCCIiwwggXMMIIDtKADAgECAhBUmNLR1FsZ
# lUgTecgRwIeZMA0GCSqGSIb3DQEBDAUAMHcxCzAJBgNVBAYTAlVTMR4wHAYDVQQK
# ExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xSDBGBgNVBAMTP01pY3Jvc29mdCBJZGVu
# dGl0eSBWZXJpZmljYXRpb24gUm9vdCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgMjAy
# MDAeFw0yMDA0MTYxODM2MTZaFw00NTA0MTYxODQ0NDBaMHcxCzAJBgNVBAYTAlVT
# MR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xSDBGBgNVBAMTP01pY3Jv
# c29mdCBJZGVudGl0eSBWZXJpZmljYXRpb24gUm9vdCBDZXJ0aWZpY2F0ZSBBdXRo
# b3JpdHkgMjAyMDCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBALORKgeD
# Bmf9np3gx8C3pOZCBH8Ppttf+9Va10Wg+3cL8IDzpm1aTXlT2KCGhFdFIMeiVPvH
# or+Kx24186IVxC9O40qFlkkN/76Z2BT2vCcH7kKbK/ULkgbk/WkTZaiRcvKYhOuD
# PQ7k13ESSCHLDe32R0m3m/nJxxe2hE//uKya13NnSYXjhr03QNAlhtTetcJtYmrV
# qXi8LW9J+eVsFBT9FMfTZRY33stuvF4pjf1imxUs1gXmuYkyM6Nix9fWUmcIxC70
# ViueC4fM7Ke0pqrrBc0ZV6U6CwQnHJFnni1iLS8evtrAIMsEGcoz+4m+mOJyoHI1
# vnnhnINv5G0Xb5DzPQCGdTiO0OBJmrvb0/gwytVXiGhNctO/bX9x2P29Da6SZEi3
# W295JrXNm5UhhNHvDzI9e1eM80UHTHzgXhgONXaLbZ7LNnSrBfjgc10yVpRnlyUK
# xjU9lJfnwUSLgP3B+PR0GeUw9gb7IVc+BhyLaxWGJ0l7gpPKWeh1R+g/OPTHU3mg
# trTiXFHvvV84wRPmeAyVWi7FQFkozA8kwOy6CXcjmTimthzax7ogttc32H83rwjj
# O3HbbnMbfZlysOSGM1l0tRYAe1BtxoYT2v3EOYI9JACaYNq6lMAFUSw0rFCZE4e7
# swWAsk0wAly4JoNdtGNz764jlU9gKL431VulAgMBAAGjVDBSMA4GA1UdDwEB/wQE
# AwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBTIftJqhSobyhmYBAcnz1AQ
# T2ioojAQBgkrBgEEAYI3FQEEAwIBADANBgkqhkiG9w0BAQwFAAOCAgEAr2rd5hnn
# LZRDGU7L6VCVZKUDkQKL4jaAOxWiUsIWGbZqWl10QzD0m/9gdAmxIR6QFm3FJI9c
# Zohj9E/MffISTEAQiwGf2qnIrvKVG8+dBetJPnSgaFvlVixlHIJ+U9pW2UYXeZJF
# xBA2CFIpF8svpvJ+1Gkkih6PsHMNzBxKq7Kq7aeRYwFkIqgyuH4yKLNncy2RtNwx
# AQv3Rwqm8ddK7VZgxCwIo3tAsLx0J1KH1r6I3TeKiW5niB31yV2g/rarOoDXGpc8
# FzYiQR6sTdWD5jw4vU8w6VSp07YEwzJ2YbuwGMUrGLPAgNW3lbBeUU0i/OxYqujY
# lLSlLu2S3ucYfCFX3VVj979tzR/SpncocMfiWzpbCNJbTsgAlrPhgzavhgplXHT2
# 6ux6anSg8Evu75SjrFDyh+3XOjCDyft9V77l4/hByuVkrrOj7FjshZrM77nq81YY
# uVxzmq/FdxeDWds3GhhyVKVB0rYjdaNDmuV3fJZ5t0GNv+zcgKCf0Xd1WF81E+Al
# GmcLfc4l+gcK5GEh2NQc5QfGNpn0ltDGFf5Ozdeui53bFv0ExpK91IjmqaOqu/dk
# ODtfzAzQNb50GQOmxapMomE2gj4d8yu8l13bS3g7LfU772Aj6PXsCyM2la+YZr9T
# 03u4aUoqlmZpxJTG9F9urJh4iIAGXKKy7aIwggbDMIIEq6ADAgECAhMzAAlVUdvE
# /r91E6nTAAAACVVRMA0GCSqGSIb3DQEBDAUAMFoxCzAJBgNVBAYTAlVTMR4wHAYD
# VQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29mdCBJ
# RCBWZXJpZmllZCBDUyBFT0MgQ0EgMDMwHhcNMjYxMDI2MDgwNzIyWhcNMjYxMDI5
# MDgwNzIyWjCBhDELMAkGA1UEBhMCVVMxDzANBgNVBAgTBkthbnNhczEQMA4GA1UE
# BxMHTGliZXJhbDEoMCYGA1UEChMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29s
# bGVnZTEoMCYGA1UEAxMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29sbGVnZTCC
# AaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBAK02+1IU/cwjyqkN9OzfTfe8
# 5tHEcubkXBod868WZltdhVQBTncTBIq3UnYS5GvTDClGXjPRb8DQNfrH3KakZoIi
# piGjb8xBw06sg6hhni4mtu3hXVFks5N8h2S7SWrb8pSiGIA8ZcnydwaCYFKY/llG
# p25otPmHruRiVXVVGHfQ8ax/hv3+Q8foUlUxXeQCO09kcu1yrwkLqDNcvtbGqDwV
# dhqHXnN+N4qxE2CBYD7NL2cbbhgx46XeyjjrwQsciOXM5HV2O9sjsNwR5Ug3+YDf
# 4fa7ZvWhItEG+tNppP/plWXoRzx1X+jW6uT5omzAbCKdyFkhBJuCq45izVRul2RY
# nGRlquewS60fOo5jEoJ6vpN4dK3EzJsqRcLwPqQjvRiXHBuXXC85z+vU1dyhZN7x
# 2Szwlz2oZAwiyaKsmXD6wURcOZ5qtFL7m7YoK6fXYcw1cl/ZdgV0hVZ8VPzsppiW
# IEb6QyZoep4682g3g/9ipawJyhdWIBQho0g9F0fgSQIDAQABo4IB1TCCAdEwDAYD
# VR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwPAYDVR0lBDUwMwYKKwYBBAGCN2EB
# AAYIKwYBBQUHAwMGGysGAQQBgjdhgpKQiVaC9aWRWIK4/vAosum1djAdBgNVHQ4E
# FgQUSqEVYXNCse+1nL2uOsQEpSxBEswwHwYDVR0jBBgwFoAUa16lNMMFxWJKIVqO
# q3NgYtSsY4UwZwYDVR0fBGAwXjBcoFqgWIZWaHR0cDovL3d3dy5taWNyb3NvZnQu
# Y29tL3BraW9wcy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENTJTIw
# RU9DJTIwQ0ElMjAwMy5jcmwwdAYIKwYBBQUHAQEEaDBmMGQGCCsGAQUFBzAChlho
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDUyUyMEVPQyUyMENBJTIwMDMuY3J0MFQGA1UdIARN
# MEswSQYEVR0gADBBMD8GCCsGAQUFBwIBFjNodHRwOi8vd3d3Lm1pY3Jvc29mdC5j
# b20vcGtpb3BzL0RvY3MvUmVwb3NpdG9yeS5odG0wDQYJKoZIhvcNAQEMBQADggIB
# ADOquN6z+NmS9xqYlTjsrKw23qNfsvKMuFJjmYsMdsE5F8pOlsYhQvWDBkwqHQVn
# BCPEOPBAu7D5emvXLkfdSJ+eUEiN3AOWqg9JEuy3+zkisKkKyf38CrTO7Yf4i63i
# 4qXWELbQhaV5RoqeywqpNI2YJOP9CFqSw37sbZip/zoyYM/N0iHbql0NvPjj/AWV
# TcPDrOP4bTpzjKw64n2D30ZnMtZFu2Zs3LaGJ53lF4B6q19m0L5q93E2+hHFKI7b
# kmxaJO1iFG1DG5mH9aKFG/OlUDoO3T8tzkWYzJPcmqhhIifuO90YgGIvM5gNPU6p
# aaGr3dMoW866TCWYqZV0/G6Fyo85LWi1QHxTf2l0XDCEQ1iE5ncJs/muuZH9k1Rs
# AgZK8f45stX//aM5YhB5ZaUvyA/Vu5KBhsEBOfSfFdzzWAyWkxTIT+R5FMf104uA
# RCBmpqAzZpxL24lWSqposMS8gNhihpSyq3we+AfHWS57ssCYuYYyZbhdWl6YiORX
# 7vR0aQlfizq/NKzcwM7fsyxvbXKDRpCyQ3llJN6cmbvIiB1KrZxRgrd0wwrTCopE
# ITRizA+KFtqVgo/AyC6V0ParpMw5h+CkuOmx4tUhLo/x2lzZtKDm2ADl/D1pkB1D
# TZ2RmPmr5XfhcX6WgL37rhckQSL6x2MefE/jEIBRqCA5MIIGwzCCBKugAwIBAgIT
# MwAJVVHbxP6/dROp0wAAAAlVUTANBgkqhkiG9w0BAQwFADBaMQswCQYDVQQGEwJV
# UzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSswKQYDVQQDEyJNaWNy
# b3NvZnQgSUQgVmVyaWZpZWQgQ1MgRU9DIENBIDAzMB4XDTI2MTAyNjA4MDcyMloX
# DTI2MTAyOTA4MDcyMlowgYQxCzAJBgNVBAYTAlVTMQ8wDQYDVQQIEwZLYW5zYXMx
# EDAOBgNVBAcTB0xpYmVyYWwxKDAmBgNVBAoTH1Nld2FyZCBDb3VudHkgQ29tbXVu
# aXR5IENvbGxlZ2UxKDAmBgNVBAMTH1Nld2FyZCBDb3VudHkgQ29tbXVuaXR5IENv
# bGxlZ2UwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQCtNvtSFP3MI8qp
# DfTs3033vObRxHLm5FwaHfOvFmZbXYVUAU53EwSKt1J2EuRr0wwpRl4z0W/A0DX6
# x9ympGaCIqYho2/MQcNOrIOoYZ4uJrbt4V1RZLOTfIdku0lq2/KUohiAPGXJ8ncG
# gmBSmP5ZRqduaLT5h67kYlV1VRh30PGsf4b9/kPH6FJVMV3kAjtPZHLtcq8JC6gz
# XL7Wxqg8FXYah15zfjeKsRNggWA+zS9nG24YMeOl3so468ELHIjlzOR1djvbI7Dc
# EeVIN/mA3+H2u2b1oSLRBvrTaaT/6ZVl6Ec8dV/o1urk+aJswGwinchZIQSbgquO
# Ys1UbpdkWJxkZarnsEutHzqOYxKCer6TeHStxMybKkXC8D6kI70Ylxwbl1wvOc/r
# 1NXcoWTe8dks8Jc9qGQMIsmirJlw+sFEXDmearRS+5u2KCun12HMNXJf2XYFdIVW
# fFT87KaYliBG+kMmaHqeOvNoN4P/YqWsCcoXViAUIaNIPRdH4EkCAwEAAaOCAdUw
# ggHRMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMDwGA1UdJQQ1MDMGCisG
# AQQBgjdhAQAGCCsGAQUFBwMDBhsrBgEEAYI3YYKSkIlWgvWlkViCuP7wKLLptXYw
# HQYDVR0OBBYEFEqhFWFzQrHvtZy9rjrEBKUsQRLMMB8GA1UdIwQYMBaAFGtepTTD
# BcViSiFajqtzYGLUrGOFMGcGA1UdHwRgMF4wXKBaoFiGVmh0dHA6Ly93d3cubWlj
# cm9zb2Z0LmNvbS9wa2lvcHMvY3JsL01pY3Jvc29mdCUyMElEJTIwVmVyaWZpZWQl
# MjBDUyUyMEVPQyUyMENBJTIwMDMuY3JsMHQGCCsGAQUFBwEBBGgwZjBkBggrBgEF
# BQcwAoZYaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNy
# b3NvZnQlMjBJRCUyMFZlcmlmaWVkJTIwQ1MlMjBFT0MlMjBDQSUyMDAzLmNydDBU
# BgNVHSAETTBLMEkGBFUdIAAwQTA/BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNy
# b3NvZnQuY29tL3BraW9wcy9Eb2NzL1JlcG9zaXRvcnkuaHRtMA0GCSqGSIb3DQEB
# DAUAA4ICAQAzqrjes/jZkvcamJU47KysNt6jX7LyjLhSY5mLDHbBORfKTpbGIUL1
# gwZMKh0FZwQjxDjwQLuw+Xpr1y5H3UifnlBIjdwDlqoPSRLst/s5IrCpCsn9/Aq0
# zu2H+Iut4uKl1hC20IWleUaKnssKqTSNmCTj/QhaksN+7G2Yqf86MmDPzdIh26pd
# Dbz44/wFlU3Dw6zj+G06c4ysOuJ9g99GZzLWRbtmbNy2hied5ReAeqtfZtC+avdx
# NvoRxSiO25JsWiTtYhRtQxuZh/WihRvzpVA6Dt0/Lc5FmMyT3JqoYSIn7jvdGIBi
# LzOYDT1OqWmhq93TKFvOukwlmKmVdPxuhcqPOS1otUB8U39pdFwwhENYhOZ3CbP5
# rrmR/ZNUbAIGSvH+ObLV//2jOWIQeWWlL8gP1buSgYbBATn0nxXc81gMlpMUyE/k
# eRTH9dOLgEQgZqagM2acS9uJVkqqaLDEvIDYYoaUsqt8HvgHx1kue7LAmLmGMmW4
# XVpemIjkV+70dGkJX4s6vzSs3MDO37Msb21yg0aQskN5ZSTenJm7yIgdSq2cUYK3
# dMMK0wqKRCE0YswPihbalYKPwMguldD2q6TMOYfgpLjpseLVIS6P8dpc2bSg5tgA
# 5fw9aZAdQ02dkZj5q+V34XF+loC9+64XJEEi+sdjHnxP4xCAUaggOTCCBygwggUQ
# oAMCAQICEzMAAAAVBT5uGY6TKdkAAAAAABUwDQYJKoZIhvcNAQEMBQAwYzELMAkG
# A1UEBhMCVVMxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjE0MDIGA1UE
# AxMrTWljcm9zb2Z0IElEIFZlcmlmaWVkIENvZGUgU2lnbmluZyBQQ0EgMjAyMTAe
# Fw0yNjAzMjYxODExMjhaFw0zMTAzMjYxODExMjhaMFoxCzAJBgNVBAYTAlVTMR4w
# HAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29m
# dCBJRCBWZXJpZmllZCBDUyBFT0MgQ0EgMDMwggIiMA0GCSqGSIb3DQEBAQUAA4IC
# DwAwggIKAoICAQDg9Ms9AqovDnMePvMOe+KybhCd8+lokzYORlS3kBVXseecbyGw
# Bcsenlm5bLtMGPjiIFLzBQF+ghlVV/U29q5GcdeEEBCHTTGhL2koIrLc4UrliMRc
# bv9mOMtR/l7/xAmv0Fx4BJHn1dHt37fvrBqXmKjKfGf5DpyO/+hnV7TEreMtS19i
# O+bjZ/9Hnpg3PCk0e7YSbRTFkx97FZwRWpC4s3NepRfRXQh/WMAj7JmsYeVZohi4
# TF5yW2JMrJZqwHcyzJZYtD2Hlno5ZEJkdiZcEaxHOobmwO06Z1J9c23ps9PGIhGa
# q1sKLEAz9Doc5rLkYWGteDrscKhAp2kIc/oYlH9Ij6BkOqqgWINEkEtC8ZNG1Mak
# +h3o65aj0iQKmdxW7IZaHO5cuyoMi+KtYfXeIIg3sVIbS2EL8kUtsDGdEqNqAq/i
# sqTi1jXqLe6iKp1ni1SPdvPW9G03CTsYF68b/yuIQRwbdoBCXemMNJCS0dorCRY4
# b2WAAy4ng7SANcEgrBgZf535+QfLU5hGzrKjIpbMabauWb5FKWUKkMsPcXFkXRWO
# 4noKPm4KWlFypqOpbJ/KONVReIlxHQRegAOBzIhRB7gr9IDQ1sc2MgOgQ+xVGW4o
# q4HD0mfAiwiyLskZrkaQ7JoanYjBNcR9RS26YxAVbcBtLitFTzCIEg5ZdQIDAQAB
# o4IB3DCCAdgwDgYDVR0PAQH/BAQDAgGGMBAGCSsGAQQBgjcVAQQDAgEAMB0GA1Ud
# DgQWBBRrXqU0wwXFYkohWo6rc2Bi1KxjhTBUBgNVHSAETTBLMEkGBFUdIAAwQTA/
# BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9Eb2Nz
# L1JlcG9zaXRvcnkuaHRtMBkGCSsGAQQBgjcUAgQMHgoAUwB1AGIAQwBBMBIGA1Ud
# EwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAU2UEpsA8PY2zvadf1zSmepEhqMOYw
# cAYDVR0fBGkwZzBloGOgYYZfaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9w
# cy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENvZGUlMjBTaWduaW5n
# JTIwUENBJTIwMjAyMS5jcmwwfQYIKwYBBQUHAQEEcTBvMG0GCCsGAQUFBzAChmFo
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDb2RlJTIwU2lnbmluZyUyMFBDQSUyMDIwMjEuY3J0
# MA0GCSqGSIb3DQEBDAUAA4ICAQBdbiI8zwXLX8glJEh/8Q22UMCUhWBO46Z9FPhw
# OR3mdlqRVLkYOon/MczUwrjDhx3X99SPH5PSflkGoTvnO9ZWHM5YFVYpO7NYuB+m
# fVSGAGZwiGOASWk0i2B7vn9nElJJmoiXxugfH5YdBsrUgTt0AFNXkzmqTgk+S1Hx
# b1u/0HCqEHVZPk2A/6eJXYbtpRM5Fcz00jisUl9BRZgSebODV85bBzOveqyC3f0P
# nHCxRJNhMb8xP/sB/VI7pf2rheSV7zqUSv8vn/fIMblXeaVIlpqoq8SP9BJMjE/C
# oVXJxnkZQRM1Fa7kN9yztvReOhxSgPgpZx/Xl/jkwyEFVJTBfBp3sTgfIc/pmqv2
# ehtakL2AEj78EmOPQohxJT3wyX+P78GA25tLpAvzj3RMMHd8z18ZuuVi+60MAzGp
# OASH1L8Nlr3fZRZnQO+pyye2DCvYmHaIfdUgYJqn7noxxGVv89+RaETh1tgCDvwN
# pFCSG7vl5A4ako+2fx409r9TWjXC7Oif1IQ5ZJzB4Rf8GvBiHYjvMmHpledp1FGR
# LdSRFVpC3/OKpZY6avIqZp7+8pP/WQP903DdgrvAT6W4xPOBxXPa4tGksN3SuqJa
# iFYHSNyeBufn8iseujW4IbBSbHD4BPqbF3qZ+7nG9d/d/G2/Lx4kH9cCmBfmsZdS
# kHmukDCCB54wggWGoAMCAQICEzMAAAAHh6M0o3uljhwAAAAAAAcwDQYJKoZIhvcN
# AQEMBQAwdzELMAkGA1UEBhMCVVMxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3Jh
# dGlvbjFIMEYGA1UEAxM/TWljcm9zb2Z0IElkZW50aXR5IFZlcmlmaWNhdGlvbiBS
# b290IENlcnRpZmljYXRlIEF1dGhvcml0eSAyMDIwMB4XDTIxMDQwMTIwMDUyMFoX
# DTM2MDQwMTIwMTUyMFowYzELMAkGA1UEBhMCVVMxHjAcBgNVBAoTFU1pY3Jvc29m
# dCBDb3Jwb3JhdGlvbjE0MDIGA1UEAxMrTWljcm9zb2Z0IElEIFZlcmlmaWVkIENv
# ZGUgU2lnbmluZyBQQ0EgMjAyMTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoC
# ggIBALLwwK8ZiCji3VR6TElsaQhVCbRS/3pK+MHrJSj3Zxd3KU3rlfL3qrZilYKJ
# NqztA9OQacr1AwoNcHbKBLbsQAhBnIB34zxf52bDpIO3NJlfIaTE/xrweLoQ71lz
# CHkD7A4As1Bs076Iu+mA6cQzsYYH/Cbl1icwQ6C65rU4V9NQhNUwgrx9rGQ//h89
# 0Q8JdjLLw0nV+ayQ2Fbkd242o9kH82RZsH3HEyqjAB5a8+Ae2nPIPc8sZU6ZE7iR
# rRZywRmrKDp5+TcmJX9MRff241UaOBs4NmHOyke8oU1TYrkxh+YeHgfWo5tTgkoS
# MoayqoDpHOLJs+qG8Tvh8SnifW2Jj3+ii11TS8/FGngEaNAWrbyfNrC69oKpRQXY
# 9bGH6jn9NEJv9weFxhTwyvx9OJLXmRGbAUXN1U9nf4lXezky6Uh/cgjkVd6CGUAf
# 0K+Jw+GE/5VpIVbcNr9rNE50Sbmy/4RTCEGvOq3GhjITbCa4crCzTTHgYYjHs1Nb
# Oc6brH+eKpWLtr+bGecy9CrwQyx7S/BfYJ+ozst7+yZtG2wR461uckFu0t+gCwLd
# N0A6cFtSRtR8bvxVFyWwTtgMMFRuBa3vmUOTnfKLsLefRaQcVTgRnzeLzdpt32cd
# YKp+dhr2ogc+qM6K4CBI5/j4VFyC4QFeUP2YAidLtvpXRRo3AgMBAAGjggI1MIIC
# MTAOBgNVHQ8BAf8EBAMCAYYwEAYJKwYBBAGCNxUBBAMCAQAwHQYDVR0OBBYEFNlB
# KbAPD2Ns72nX9c0pnqRIajDmMFQGA1UdIARNMEswSQYEVR0gADBBMD8GCCsGAQUF
# BwIBFjNodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL0RvY3MvUmVwb3Np
# dG9yeS5odG0wGQYJKwYBBAGCNxQCBAweCgBTAHUAYgBDAEEwDwYDVR0TAQH/BAUw
# AwEB/zAfBgNVHSMEGDAWgBTIftJqhSobyhmYBAcnz1AQT2ioojCBhAYDVR0fBH0w
# ezB5oHegdYZzaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jcmwvTWlj
# cm9zb2Z0JTIwSWRlbnRpdHklMjBWZXJpZmljYXRpb24lMjBSb290JTIwQ2VydGlm
# aWNhdGUlMjBBdXRob3JpdHklMjAyMDIwLmNybDCBwwYIKwYBBQUHAQEEgbYwgbMw
# gYEGCCsGAQUFBzAChnVodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2Nl
# cnRzL01pY3Jvc29mdCUyMElkZW50aXR5JTIwVmVyaWZpY2F0aW9uJTIwUm9vdCUy
# MENlcnRpZmljYXRlJTIwQXV0aG9yaXR5JTIwMjAyMC5jcnQwLQYIKwYBBQUHMAGG
# IWh0dHA6Ly9vbmVvY3NwLm1pY3Jvc29mdC5jb20vb2NzcDANBgkqhkiG9w0BAQwF
# AAOCAgEAfyUqnv7Uq+rdZgrbVyNMul5skONbhls5fccPlmIbzi+OwVdPQ4H55v7V
# OInnmezQEeW4LqK0wja+fBznANbXLB0KrdMCbHQpbLvG6UA/Xv2pfpVIE1CRFfNF
# 4XKO8XYEa3oW8oVH+KZHgIQRIwAbyFKQ9iyj4aOWeAzwk+f9E5StNp5T8FG7/VEU
# RIVWArbAzPt9ThVN3w1fAZkF7+YU9kbq1bCR2YD+MtunSQ1Rft6XG7b4e0ejRA7m
# B2IoX5hNh3UEauY0byxNRG+fT2MCEhQl9g2i2fs6VOG19CNep7SquKaBjhWmirYy
# ANb0RJSLWjinMLXNOAga10n8i9jqeprzSMU5ODmrMCJE12xS/NWShg/tuLjAsKP6
# SzYZ+1Ry358ZTFcx0FS/mx2vSoU8s8HRvy+rnXqyUJ9HBqS0DErVLjQwK8VtsBde
# kBmdTbQVoCgPCqr+PDPB3xajYnzevs7eidBsM71PINK2BoE2UfMwxCCX3mccFgx6
# UsQeRSdVVVNSyALQe6PT12418xon2iDGE81OGCreLzDcMAZnrUAx4XQLUz6ZTl65
# yPUiOh3k7Yww94lDf+8oG2oZmDh5O1Qe38E+M3vhKwmzIeoB1dVLlz4i3IpaDcR+
# iuGjH2TdaC1ZOmBXiCRKJLj4DT2uhJ04ji+tHD6n58vhavFIrmcxghqUMIIakAIB
# ATBxMFoxCzAJBgNVBAYTAlVTMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRp
# b24xKzApBgNVBAMTIk1pY3Jvc29mdCBJRCBWZXJpZmllZCBDUyBFT0MgQ0EgMDMC
# EzMACVVR28T+v3UTqdMAAAAJVVEwDQYJYIZIAWUDBAIBBQCgXjAQBgorBgEEAYI3
# AgEMMQIwADAZBgkqhkiG9w0BCQMxDAYKKwYBBAGCNwIBBDAvBgkqhkiG9w0BCQQx
# IgQgDW+dy1wwFxweRz0+wniygQLWzUErDoIEOJlSuCZzXigwDQYJKoZIhvcNAQEB
# BQAEggGACg4Nhk1Fxv5KsXk1ENAIXY8QwGZSpe6kez3P87C71u/qs1iM6v0vCVkX
# aYVmnUt9fSbsVi4UEOtyhLycO2eGdIpwm/i/+UlIu6DQXWy5ostmqywQzD2HCaLJ
# nQ/hY+rMMo3BZ+cBniCpfKOLFwDNY1RGCaJKv/cfMQet8kAaVxSMtiBF5z13bqMn
# uiq+DlFuMgBB9KGQc45uMeUyw3v2oFio2AX84gscRWnu/Ouu1JWp/3s0vVy3ssUy
# 8CSSBa7/2fN/IQyAYxXV/bYy5sMSYNg5sZB6FILPWoz9Mu+ZKudXZ6RcZxmhQzxu
# rkoszKtdHlZmZq/9NccZ1UKWLMd5qEBudn0QTAcLt9OI+mdNmbjW5IfYtH/S0CJK
# X/iPmijB09W4xccXShG9EO0oNgRfTy9ZhcrCSr0ujIf6zOmbbkm90YfUFKvC2x6F
# /krQDh0Qo1qH7nC+VmaFTW4jIuiFB7Vi3I2OhMgwWkXx0wL8bEyUON8G2I8UA4ji
# lFXKOkWboYIYFDCCGBAGCisGAQQBgjcDAwExghgAMIIX/AYJKoZIhvcNAQcCoIIX
# 7TCCF+kCAQMxDzANBglghkgBZQMEAgEFADCCAWIGCyqGSIb3DQEJEAEEoIIBUQSC
# AU0wggFJAgEBBgorBgEEAYRZCgMBMDEwDQYJYIZIAWUDBAIBBQAEIKMLC7WTSXYT
# P1FMj70boYBVg85WPBnQMn3agby9ubhnAgZq2055ZMEYEzIwMjYxMDI3MDkzMDQz
# LjYzNVowBIACAfSggeGkgd4wgdsxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNo
# aW5ndG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29y
# cG9yYXRpb24xJTAjBgNVBAsTHE1pY3Jvc29mdCBBbWVyaWNhIE9wZXJhdGlvbnMx
# JzAlBgNVBAsTHm5TaGllbGQgVFNTIEVTTjo3RDAwLTA1RTAtRDk0NzE1MDMGA1UE
# AxMsTWljcm9zb2Z0IFB1YmxpYyBSU0EgVGltZSBTdGFtcGluZyBBdXRob3JpdHmg
# gg8hMIIHgjCCBWqgAwIBAgITMwAAAAXlzw//Zi7JhwAAAAAABTANBgkqhkiG9w0B
# AQwFADB3MQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0
# aW9uMUgwRgYDVQQDEz9NaWNyb3NvZnQgSWRlbnRpdHkgVmVyaWZpY2F0aW9uIFJv
# b3QgQ2VydGlmaWNhdGUgQXV0aG9yaXR5IDIwMjAwHhcNMjAxMTE5MjAzMjMxWhcN
# MzUxMTE5MjA0MjMxWjBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0
# IENvcnBvcmF0aW9uMTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1l
# c3RhbXBpbmcgQ0EgMjAyMDCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIB
# AJ5851Jj/eDFnwV9Y7UGIqMcHtfnlzPREwW9ZUZHd5HBXXBvf7KrQ5cMSqFSHGqg
# 2/qJhYqOQxwuEQXG8kB41wsDJP5d0zmLYKAY8Zxv3lYkuLDsfMuIEqvGYOPURAH+
# Ybl4SJEESnt0MbPEoKdNihwM5xGv0rGofJ1qOYSTNcc55EbBT7uq3wx3mXhtVmtc
# CEr5ZKTkKKE1CxZvNPWdGWJUPC6e4uRfWHIhZcgCsJ+sozf5EeH5KrlFnxpjKKTa
# vwfFP6XaGZGWUG8TZaiTogRoAlqcevbiqioUz1Yt4FRK53P6ovnUfANjIgM9JDdJ
# 4e0qiDRm5sOTiEQtBLGd9Vhd1MadxoGcHrRCsS5rO9yhv2fjJHrmlQ0EIXmp4DhD
# BieKUGR+eZ4CNE3ctW4uvSDQVeSp9h1SaPV8UWEfyTxgGjOsRpeexIveR1MPTVf7
# gt8hY64XNPO6iyUGsEgt8c2PxF87E+CO7A28TpjNq5eLiiunhKbq0XbjkNoU5Jht
# YUrlmAbpxRjb9tSreDdtACpm3rkpxp7AQndnI0Shu/fk1/rE3oWsDqMX3jjv40e8
# KN5YsJBnczyWB4JyeeFMW3JBfdeAKhzohFe8U5w9WuvcP1E8cIxLoKSDzCCBOu0h
# WdjzKNu8Y5SwB1lt5dQhABYyzR3dxEO/T1K/BVF3rV69AgMBAAGjggIbMIICFzAO
# BgNVHQ8BAf8EBAMCAYYwEAYJKwYBBAGCNxUBBAMCAQAwHQYDVR0OBBYEFGtpKDo1
# L0hjQM972K9J6T7ZPdshMFQGA1UdIARNMEswSQYEVR0gADBBMD8GCCsGAQUFBwIB
# FjNodHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL0RvY3MvUmVwb3NpdG9y
# eS5odG0wEwYDVR0lBAwwCgYIKwYBBQUHAwgwGQYJKwYBBAGCNxQCBAweCgBTAHUA
# YgBDAEEwDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSMEGDAWgBTIftJqhSobyhmYBAcn
# z1AQT2ioojCBhAYDVR0fBH0wezB5oHegdYZzaHR0cDovL3d3dy5taWNyb3NvZnQu
# Y29tL3BraW9wcy9jcmwvTWljcm9zb2Z0JTIwSWRlbnRpdHklMjBWZXJpZmljYXRp
# b24lMjBSb290JTIwQ2VydGlmaWNhdGUlMjBBdXRob3JpdHklMjAyMDIwLmNybDCB
# lAYIKwYBBQUHAQEEgYcwgYQwgYEGCCsGAQUFBzAChnVodHRwOi8vd3d3Lm1pY3Jv
# c29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUyMElkZW50aXR5JTIwVmVy
# aWZpY2F0aW9uJTIwUm9vdCUyMENlcnRpZmljYXRlJTIwQXV0aG9yaXR5JTIwMjAy
# MC5jcnQwDQYJKoZIhvcNAQEMBQADggIBAF+Idsd+bbVaFXXnTHho+k7h2ESZJRWl
# uLE0Oa/pO+4ge/XEizXvhs0Y7+KVYyb4nHlugBesnFqBGEdC2IWmtKMyS1OWIviw
# pnK3aL5JedwzbeBF7POyg6IGG/XhhJ3UqWeWTO+Czb1c2NP5zyEh89F72u9UIw+I
# fvM9lzDmc2O2END7MPnrcjWdQnrLn1Ntday7JSyrDvBdmgbNnCKNZPmhzoa8PccO
# iQljjTW6GePe5sGFuRHzdFt8y+bN2neF7Zu8hTO1I64XNGqst8S+w+RUdie8fXC1
# jKu3m9KGIqF4aldrYBamyh3g4nJPj/LR2CBaLyD+2BuGZCVmoNR/dSpRCxlot0i7
# 9dKOChmoONqbMI8m04uLaEHAv4qwKHQ1vBzbV/nG89LDKbRSSvijmwJwxRxLLpMQ
# /u4xXxFfR4f/gksSkbJp7oqLwliDm/h+w0aJ/U5ccnYhYb7vPKNMN+SZDWycU5OD
# IRfyoGl59BsXR/HpRGtiJquOYGmvA/pk5vC1lcnbeMrcWD/26ozePQ/TWfNXKBOm
# kFpvPE8CH+EeGGWzqTCjdAsno2jzTeNSxlx3glDGJgcdz5D/AAxw9Sdgq/+rY7jj
# gs7X6fqPTXPmaCAJKVHAP19oEjJIBwD1LyHbaEgBxFCogYSOiUIr0Xqcr1nJfiWG
# 2GwYe6ZoAF1bMIIHlzCCBX+gAwIBAgITMwAAAF8q5PgjRbwaSQAAAAAAXzANBgkq
# hkiG9w0BAQwFADBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENv
# cnBvcmF0aW9uMTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3Rh
# bXBpbmcgQ0EgMjAyMDAeFw0yNjA5MTcxODU3MjVaFw0yNzA5MTQxODU3MjVaMIHb
# MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVk
# bW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSUwIwYDVQQLExxN
# aWNyb3NvZnQgQW1lcmljYSBPcGVyYXRpb25zMScwJQYDVQQLEx5uU2hpZWxkIFRT
# UyBFU046N0QwMC0wNUUwLUQ5NDcxNTAzBgNVBAMTLE1pY3Jvc29mdCBQdWJsaWMg
# UlNBIFRpbWUgU3RhbXBpbmcgQXV0aG9yaXR5MIICIjANBgkqhkiG9w0BAQEFAAOC
# Ag8AMIICCgKCAgEA51SXw150uzdVDaSg9y81N0KF1++mAwWpNpRQgF8rEc9NWisw
# hKtKgRerh+PjXSHbiwIqlZvX4u6VwRDdNmNo2oBRfieExGrTNw56kaLCB31wVvyB
# Mt5Lxi4hkIc21Ek+poAzU9EhRgsUr7MYJQLKcBL07GGX3/PGdSrLNTkgxaUz/2oZ
# vcmS4f8qqoVBOUh22ia7QFJHPUOa12moxGmze28Fu9+Jxto8kLEZ9Gs9K2CTYrLx
# s6KSP10WwjouAj2fSgqH2POob3euigzLwpmj6Yh+KdJu0NYBNfoEBTJLV7kPx5Ho
# ZXkSf/Yz3h9G9XQNFcNibTqtpkR8PpdjYMdRJvnoEVa/8vrfc5sbuYrJkVeZ9H16
# HVUGDsDHWPvLn1MSxMTg4Td3Jv6Y5tnAnl/yHxiQFlE1zW/c2fKfYvD+ZcSeKEYv
# UTmp31/bZ0V8pmEOD9IL3gECb7a6cGhsMZvpzg6WUNpW66CwL/m5MXLEzrM0qJNn
# YUF1RkaQ8IYuGYzdJPf06i0Cu/deEsiZLbhkCcZG3WVj/JuBjYQiKl8OKwqs//Qa
# wn7OcyxU1cWL3J37x6Pta6CyKrxZ2rriFBMgIDJHJIDJ4kwPinvlkUDbwLnjo0hs
# 0Smi903emDdG9IH/vXGzPSiFIveh+5sg3eiXYbklkfHYZOM5mRP5sE6GXV0CAwEA
# AaOCAcswggHHMB0GA1UdDgQWBBRSh08N0S56eMV5ovb2CoDv/Dla3DAfBgNVHSME
# GDAWgBRraSg6NS9IY0DPe9ivSek+2T3bITBsBgNVHR8EZTBjMGGgX6BdhltodHRw
# Oi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NybC9NaWNyb3NvZnQlMjBQdWJs
# aWMlMjBSU0ElMjBUaW1lc3RhbXBpbmclMjBDQSUyMDIwMjAuY3JsMHkGCCsGAQUF
# BwEBBG0wazBpBggrBgEFBQcwAoZdaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3Br
# aW9wcy9jZXJ0cy9NaWNyb3NvZnQlMjBQdWJsaWMlMjBSU0ElMjBUaW1lc3RhbXBp
# bmclMjBDQSUyMDIwMjAuY3J0MAwGA1UdEwEB/wQCMAAwFgYDVR0lAQH/BAwwCgYI
# KwYBBQUHAwgwDgYDVR0PAQH/BAQDAgeAMGYGA1UdIARfMF0wUQYMKwYBBAGCN0yD
# fQEBMEEwPwYIKwYBBQUHAgEWM2h0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2lv
# cHMvRG9jcy9SZXBvc2l0b3J5Lmh0bTAIBgZngQwBBAIwDQYJKoZIhvcNAQEMBQAD
# ggIBADGiVwzuujXhCimnfTFpNUQoBQkG0A1fWl4/K4oqFCh6/JK+xZdA42GNGoIZ
# 5Qbxls4cMTDHfECHr+A5ZzIZ9AZODvHkPrvTAbtK3wdaykDvbWLC+LP0SZp3Hpea
# qX39+MSojslm+AoqpqwQB0xazBrZ/eS2AhaoKNXd0coLhJ9EnwzhO0/C7FgGG+uL
# WS5qBQ7766vpguEjbftNivU5odo9YXlPuPbmhHRJwBchZSFbLNV/9Jdce6nDzdG5
# 19o7sOJwzAISLDTlhXN2ezH4NqRIpFYo9O2qvjNXfNDoopqHoeg0BoDPacdouiJT
# rZ4F2FyYS1lwQWrY1CS362zukhFWelBiOk8HCxfyXLPnkrKKIdxIegEVHz/2Izch
# xQVc9jk2d+mUZdUPSGyaYZBAGYYY/XdV5/7G6vC3WoZ4ducToCSzhI4k3p8Tlfns
# gMaSuQ2/MryubX7w6jvPx0+NXhYuS9ROcy2Sgt846q+zAzhWM2aFapwmf/aGvUIt
# PjiEcdNkEfwThGLhlO2p+NFDA8eWAX69VCNigGAUhey9PFJkbYstbLExGTLEJB2m
# mWPplSdQNjiKP1zE5k9lxWydqP9UswvvYMce9QmhL1dZoUye7Y0BuDzUnAaPoKJj
# e3JD9u0dYDTUdxqi7D0FZbI4Q0jl4C5L9UtGwfKqLhMdFcMjMYIHRjCCB0ICAQEw
# eDBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
# MTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0Eg
# MjAyMAITMwAAAF8q5PgjRbwaSQAAAAAAXzANBglghkgBZQMEAgEFAKCCBJ8wEQYL
# KoZIhvcNAQkQAg8xAgUAMBoGCSqGSIb3DQEJAzENBgsqhkiG9w0BCRABBDAcBgkq
# hkiG9w0BCQUxDxcNMjYxMDI3MDkzMDQzWjAvBgkqhkiG9w0BCQQxIgQgC8MELMHV
# SHrz763HD8hyfuOskcDdWwoc8KyRX/P5qIYwgbkGCyqGSIb3DQEJEAIvMYGpMIGm
# MIGjMIGgBCBs9gl+q1f0gODShST0SrC3UF5snHnW4n8wXlLHWy4lwzB8MGWkYzBh
# MQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMTIw
# MAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0EgMjAy
# MAITMwAAAF8q5PgjRbwaSQAAAAAAXzCCA2EGCyqGSIb3DQEJEAISMYIDUDCCA0yh
# ggNIMIIDRDCCAiwCAQEwggEJoYHhpIHeMIHbMQswCQYDVQQGEwJVUzETMBEGA1UE
# CBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9z
# b2Z0IENvcnBvcmF0aW9uMSUwIwYDVQQLExxNaWNyb3NvZnQgQW1lcmljYSBPcGVy
# YXRpb25zMScwJQYDVQQLEx5uU2hpZWxkIFRTUyBFU046N0QwMC0wNUUwLUQ5NDcx
# NTAzBgNVBAMTLE1pY3Jvc29mdCBQdWJsaWMgUlNBIFRpbWUgU3RhbXBpbmcgQXV0
# aG9yaXR5oiMKAQEwBwYFKw4DAhoDFQBxCTre8Ly7mMuvAIjyU0vuhvLsb6BnMGWk
# YzBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
# MTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0Eg
# MjAyMDANBgkqhkiG9w0BAQsFAAIFAO6KajYwIhgPMjAyNjEwMjcwMDA5MjZaGA8y
# MDI2MTAyODAwMDkyNlowdzA9BgorBgEEAYRZCgQBMS8wLTAKAgUA7opqNgIBADAK
# AgEAAgIGfAIB/zAHAgEAAgIS2zAKAgUA7ou7tgIBADA2BgorBgEEAYRZCgQCMSgw
# JjAMBgorBgEEAYRZCgMCoAowCAIBAAIDB6EgoQowCAIBAAIDAYagMA0GCSqGSIb3
# DQEBCwUAA4IBAQBHMdJA+cyAGlLCGlEt8Qu5MJ7gWpiPVkeRPvwxC6e2uSuG2dTZ
# TLy8u2i0T8xZ6fZ4shPdScTN1LwhPZUck1gmHDduZddcxx+KZjxc/kwWw5AR1rmE
# 80wxs6AEn+r9kKBC5p7TaaqbCsXOemm2Fsd+s04LORE07/9bdb2g5dYYUgH2rRmP
# Q1dAqD4WUCmDD4GCG2HlT/wJXgH20nkcqH1+inQ1axjPter+fyI1+5KauTr6ZNgQ
# QuuyrTuipDyST8pe6I4b2ecvxh/HZ6hhJgz12QoBkSjPIcRIjHmB6lFQYSfWE4aI
# wBJ1bzYaV7HN3scYJcKHwCx/c91gRDnIDkw5MA0GCSqGSIb3DQEBAQUABIICAKUU
# n8aCY0qeUyRGEBklJmqnH96Cr0TF6RbHprPfUOXg0gnPiF2MTDvaMnu1KdwoaXpo
# bMIljVPCnJM7vpU8wClsid4gwQofXqGmgOVR5Xq2+faF3gVowok4EuhsTswte1dq
# +aK467G0dbwByZ/2NT8dgzHa6XSx7VMp4kNwR6EUoAzwNMvx4aMizR6ZxF+hDJR4
# LI3sHEH2S5v62HjNINGQMqszOB+daswL/fszZls94Kdn2bdek4RM+wFGTlIhOOwP
# gwn0cjWUcxWP8kZ1OHLurLPSZ2q59SB0MiMhGAhlJbftRl/ZjU8keyjEN2KgeEBq
# mUDovpHlvC+i7D2Rbpf/hkCBm0f8wjcX40juIYbF8JpDMN94c4t55LBbutVugf7o
# HBVqYjPfff0eyqo1utYbCueOFOXgpAXgls8WTmnpBh+p70Vhrg9J6WsmXydTUriP
# RQWrL6jZgB7h7bkHfXep9wiy2tcS0FMBzqMd4k8geXs05MjPatWIMeZUEgvzkmJ5
# 7lw/Y1Lsfa4rJq4TAo5NskjDyIQoDBZo+d9IYOqcEh+o72pOHjV1ZPGJeTGUlAOE
# NXQBGytZPP9Booi/h6UeuVNNHFXOlVDLVaCre+7iwX5ki+ZtW505KzGpdeFjvRdP
# UbVZhSORjRtJTS4cUg9kQuHNiVd+VIUJjHR7/O/8
# SIG # End signature block
