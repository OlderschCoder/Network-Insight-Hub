#Requires -Version 7.2
#Requires -RunAsAdministrator
[CmdletBinding()]
param([switch]$Watch)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root='C:\ProgramData\SCCC-DiagnosticsBulkController'
$receipt='C:\Users\mark.bojeun\Documents\Codex\2026-09-29\sccc-key-task\outputs\diagnostics-bulk-preflight\controller-readiness.json'
$source='C:\Users\mark.bojeun\Documents\Codex\2026-10-26\bulk-diagnostics-enrollment\Fred\deploy\building-diagnostics\Invoke-BulkDiagnosticsEnrollment.ps1'
$zip='C:\Users\mark.bojeun\Documents\Codex\2026-09-29\sccc-key-task\outputs\building-speed-20261025\SCCC-Diagnostics-1.1.0-rc1.zip'
$phase='OperatorValidation';$session=$null;$workerBytes=$null;$clear=$null
function PrivateDirectory([string]$Path){
 if(Test-Path -LiteralPath $Path){
  $entry=Get-Item -LiteralPath $Path -Force
  if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse path refused'}
  $acl=Get-Acl -LiteralPath $Path
  if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Existing private directory owner/ACL mismatch'}
  foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Unexpected private directory access'}}
  return
 }
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
 [void][IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path),$acl)
 PrivateDirectory $Path
}
try{
 if($env:COMPUTERNAME -ine 'LP-AA152MB-01' -or [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-21-4013532473-1306839332-4181249023-66686'){throw 'Approved operator workstation/account required'}
 $expectedController='091B89F3F72E5270FA010F372379BC0E7E10B559B5CF733EA7B2C0B4B6B366DB'
 $previousController='DFDEA0460BC9C33D547B76C56424E145C8BD75D06D5495206BEC7E23A453F965'
 if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -cne $expectedController){throw 'Controller source hash changed'}
 if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -cne 'DE2626613DBF1B90898FF38DAD8999A6DB5D9C582E117F0886B774AB832788A3'){throw 'Pinned payload archive changed'}
 $phase='ProtectedControllerStage';PrivateDirectory $root
 $controller=Join-Path $root 'Invoke-BulkDiagnosticsEnrollment.ps1'
 if(Test-Path -LiteralPath $controller){
  $installedControllerHash=(Get-FileHash -LiteralPath $controller -Algorithm SHA256).Hash
  if($installedControllerHash -ceq $previousController){
   $backup=Join-Path $root 'controller-before-child-error-fix.ps1'
   if(Test-Path -LiteralPath $backup){if((Get-FileHash -LiteralPath $backup).Hash -cne $previousController){throw 'Protected controller backup drift'}}else{Copy-Item -LiteralPath $controller -Destination $backup}
   $replacement=Join-Path $root 'controller-reviewed-replacement.ps1'
   [IO.File]::Copy($source,$replacement,$false)
   if((Get-FileHash -LiteralPath $replacement).Hash -cne $expectedController){throw 'Protected controller replacement hash mismatch'}
   [IO.File]::Move($replacement,$controller,$true)
  }elseif($installedControllerHash -cne $expectedController){throw 'Protected controller drift'}
 }else{Copy-Item -LiteralPath $source -Destination $controller}
 $payload=Join-Path $root 'payload';PrivateDirectory $payload
 $pinned=@{'Install-DiagnosticsAgent.ps1'='557D4A1799F80174229EFA5801FB6B1E31CDF09700FF7C73F111AD2C6324781E';'Invoke-DiagnosticsAgent.ps1'='25AA875D167CEF8898C7CC018A48058CE7BA3E6C9325913AD20837FFE794BDDF';'Sccc.Diagnostics.psm1'='0BE3E9B21B4263AD59251277C3427043E22AB8E3DAAFF47D120410DE1FFF76F8';'ExternalProbe.dll'='B79FEB87B4F2EEE951308C34D2397516C5602F6A2A103E3BDB1C38767A4FDC85'}
 $phase='PinnedPayload';$archive=[IO.Compression.ZipFile]::OpenRead($zip)
 try{foreach($name in $pinned.Keys){
  $phase='PinnedPayload.'+$name;$target=Join-Path $payload $name
  if(-not(Test-Path -LiteralPath $target)){$entry=$archive.GetEntry('1.1.0-rc1\'+$name);if(-not $entry){throw 'Pinned archive member missing'};[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)}
  $sig=Get-AuthenticodeSignature -LiteralPath $target;$actualHash=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  [pscustomobject]@{File=$name;Hash=$actualHash;SignatureStatus=$sig.Status.ToString();Signer=$sig.SignerCertificate.Thumbprint;Timestamped=[bool]$sig.TimeStamperCertificate;CheckedUtc=[DateTimeOffset]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath ($receipt+'.payload.json') -Encoding utf8
  if($actualHash -cne $pinned[$name] -or $sig.Status -ne 'Valid' -or $sig.SignerCertificate.Thumbprint -ine '9C6F10572711B7BD83AED649B405E239A9F345B0' -or -not $sig.TimeStamperCertificate){throw 'Protected signed payload validation failed'}
 }}finally{$archive.Dispose()}
 $phase='ExistingAuthorityTransfer'
 $credential=Join-Path $root 'worker.dpapi'
 if(-not(Test-Path -LiteralPath $credential)){
  $session=New-PSSession -ComputerName LP-F6K6S64.sccc.edu -Authentication Kerberos -SessionOption (New-PSSessionOption -OpenTimeout 5000 -OperationTimeout 30000)
  $workerBytes=Invoke-Command -Session $session -ScriptBlock {
   $ErrorActionPreference='Stop'
   $system=Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 8
   if($env:COMPUTERNAME -ine 'LP-F6K6S64' -or -not $system.PartOfDomain -or $system.Domain -ine 'sccc.edu'){throw 'Authority source host mismatch'}
   $path='C:\ProgramData\SCCC-DiagnosticsPublisher\worker.dpapi'
   foreach($p in @($path,(Split-Path -Parent $path))){$entry=Get-Item -LiteralPath $p -Force;$acl=Get-Acl -LiteralPath $p;if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Existing authority ACL mismatch'};foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Unexpected authority access'}}}
   Add-Type -AssemblyName System.Security
   $raw=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($path),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
   try{if($raw.Length -lt 32 -or $raw.Length -gt 256){throw 'Unexpected existing authority length'};,([byte[]]$raw.Clone())}finally{[Array]::Clear($raw,0,$raw.Length)}
  }
  $clear=[byte[]]$workerBytes
  if($clear.Length -lt 32 -or $clear.Length -gt 256){throw 'Existing authority transfer length mismatch'}
  Add-Type -AssemblyName System.Security
  $sealed=[Security.Cryptography.ProtectedData]::Protect($clear,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
  $stream=[IO.File]::Open($credential,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$stream.Write($sealed,0,$sealed.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  $acl=Get-Acl -LiteralPath $credential;$acl.SetAccessRuleProtection($true,$true);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));Set-Acl -LiteralPath $credential -AclObject $acl
 }
 if($clear){[Array]::Clear($clear,0,$clear.Length)};$clear=$null;$workerBytes=$null
 if($session){Remove-PSSession $session;$session=$null}
 $phase='ControllerReady'
 [pscustomobject]@{Status='Ready';Computer=$env:COMPUTERNAME;ProcessId=$PID;CheckedUtc=[DateTimeOffset]::UtcNow.ToString('o');ControllerSha256=(Get-FileHash $controller).Hash;CredentialPrinted=$false;GpoChanged=$false;MeasurementsRequested=$false;Watch=[bool]$Watch}|ConvertTo-Json|Set-Content -LiteralPath $receipt -Encoding utf8
 & $controller -FredOrigin 'https://app-server2.centralus.cloudapp.azure.com/' -WorkerCredentialPath $credential -AgentSourceDirectory $payload -ReceiptDirectory (Join-Path $root 'receipts') -Watch:$Watch
}catch{
 [pscustomobject]@{Status='StoppedRequiresReview';Phase=$phase;Computer=$env:COMPUTERNAME;ActorSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;FailureLine=$_.InvocationInfo.ScriptLineNumber;FailureScript=$_.InvocationInfo.ScriptName;ErrorId=$_.FullyQualifiedErrorId;ExceptionType=$_.Exception.GetType().FullName;HResult=$_.Exception.HResult;NativeErrorCode=if($_.Exception -is [ComponentModel.Win32Exception]){$_.Exception.NativeErrorCode}else{$null};NativeErrorMessage=if($_.Exception -is [ComponentModel.Win32Exception]){$_.Exception.Message}else{$null};CheckedUtc=[DateTimeOffset]::UtcNow.ToString('o');CredentialPrinted=$false;GpoChanged=$false;MeasurementsRequested=$false}|ConvertTo-Json|Set-Content -LiteralPath $receipt -Encoding utf8
 exit 1
}finally{if($clear){[Array]::Clear($clear,0,$clear.Length)};$workerBytes=$null;if($session){Remove-PSSession $session}}
