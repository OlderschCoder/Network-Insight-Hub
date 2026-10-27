#Requires -Version 7.2
#Requires -RunAsAdministrator
# Independent diagnostics enrollment only. Never changes GPO, Alert/MFA, scheduler settings, or measurement jobs.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$FredOrigin,
    [Parameter(Mandatory)][string]$WorkerCredentialPath,
    [Parameter(Mandatory)][string]$AgentSourceDirectory,
    [string]$ReceiptDirectory=(Join-Path $env:ProgramData 'SCCC-Diagnostics\BulkEnrollment\Receipts'),
    [string]$DomainController='ad-sc00.sccc.edu',
    [string]$DnsServer='10.40.1.77',
    [switch]$Watch
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$origin=[Uri]$FredOrigin
if(-not $origin.IsAbsoluteUri -or $origin.Scheme -ne 'https' -or -not $origin.IsDefaultPort -or $origin.UserInfo -or $origin.Query -or $origin.Fragment -or $origin.AbsolutePath -ne '/'){throw 'Use the reviewed HTTPS Fred origin without credentials, path or query.'}
$FredOrigin=$origin.GetLeftPart([UriPartial]::Authority)
if($DomainController -ine 'ad-sc00.sccc.edu' -or $DnsServer -ne '10.40.1.77'){throw 'This rollout is pinned to the reviewed private SCCC directory/DNS authorities.'}
$controllerAddresses=@(Resolve-DnsName -Name $DomainController -Server $DnsServer -Type A -DnsOnly -QuickTimeout|Where-Object{$_.Name -ieq $DomainController -and $_.Section -eq 'Answer' -and $_.IPAddress}|Select-Object -ExpandProperty IPAddress -Unique)
if($controllerAddresses.Count -ne 1 -or $controllerAddresses[0] -ne '10.0.0.46'){throw 'Pinned private directory-controller DNS answer did not verify.'}
$signer='9C6F10572711B7BD83AED649B405E239A9F345B0'
$payloadHashes=@{
 'Install-DiagnosticsAgent.ps1'='557D4A1799F80174229EFA5801FB6B1E31CDF09700FF7C73F111AD2C6324781E'
 'Invoke-DiagnosticsAgent.ps1'='25AA875D167CEF8898C7CC018A48058CE7BA3E6C9325913AD20837FFE794BDDF'
 'Sccc.Diagnostics.psm1'='0BE3E9B21B4263AD59251277C3427043E22AB8E3DAAFF47D120410DE1FFF76F8'
 'ExternalProbe.dll'='B79FEB87B4F2EEE951308C34D2397516C5602F6A2A103E3BDB1C38767A4FDC85'
}
function Assert-NoReparse([string]$Path){
 $cursor=[IO.Path]::GetFullPath($Path)
 while($cursor){if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse paths are not allowed.'}};$parent=Split-Path -Parent $cursor;if($parent -eq $cursor){break};$cursor=$parent}
}
function Assert-Private([string]$Path){
 Assert-NoReparse $Path
 $acl=Get-Acl -LiteralPath $Path
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Protected path must be owned by SYSTEM or Administrators.'}
 if(-not $acl.AreAccessRulesProtected){throw 'Protected path must have inheritance disabled.'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Protected path may grant access only to SYSTEM and Administrators.'}}
}
function New-PrivateDirectory([string]$Path){
 Assert-NoReparse $Path
 if(Test-Path -LiteralPath $Path){Assert-Private $Path;return}
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
 foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
 [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path),$acl)
 Assert-Private $Path
}
foreach($entry in $payloadHashes.GetEnumerator()){
 $path=Join-Path $AgentSourceDirectory $entry.Key;Assert-NoReparse $path
 $signature=Get-AuthenticodeSignature -LiteralPath $path
 if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $entry.Value -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $signer -or -not $signature.TimeStamperCertificate){throw 'Pinned reviewed diagnostics payload validation failed.'}
}
Assert-Private $WorkerCredentialPath
Assert-Private (Split-Path -Parent ([IO.Path]::GetFullPath($WorkerCredentialPath)))
New-PrivateDirectory $ReceiptDirectory
Add-Type -AssemblyName System.Security
$clear=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($WorkerCredentialPath),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
try{$workerToken=[Text.Encoding]::UTF8.GetString($clear)}finally{[Array]::Clear($clear,0,$clear.Length)}
if($workerToken.Length -lt 32 -or $workerToken -match '\s'){throw 'A protected dedicated worker credential is required.'}
$headers=@{Authorization='Bearer '+$workerToken}
try{
 do{
  $batch=Invoke-RestMethod -Uri ($FredOrigin+'/api/building-diagnostics/devices/bulk-enrollment/worker/claim') -Method Post -Headers $headers -ContentType 'application/json' -Body (@{workerId=$env:COMPUTERNAME}|ConvertTo-Json -Compress) -MaximumRedirection 0 -TimeoutSec 30
  $externalOrigin=[string]$batch.policy.externalProbeOrigin
  if($externalOrigin){$external=[Uri]$externalOrigin;if(-not $external.IsAbsoluteUri -or $external.Scheme -ne 'https' -or -not $external.IsDefaultPort -or $external.HostNameType -ne 'Dns' -or $external.UserInfo -or $external.Query -or $external.Fragment -or $external.AbsolutePath -ne '/'){throw 'The reviewed server external-origin policy did not validate.'}}
  @($batch.items)|ForEach-Object -Parallel {
   Set-StrictMode -Version Latest
   $ErrorActionPreference='Stop'
   $item=$_;$session=$null;$credential=$null;$phase='directory';$reason='installation-failed';$status='failed';$evidence=$null;$policyEvidence=$null;$failure=$null;$credentialAttempted=$false;$remoteStage=$null
   $apiOrigin=$using:FredOrigin;$authorization=$using:headers;$source=$using:AgentSourceDirectory;$expectedSigner=$using:signer;$hashes=$using:payloadHashes
   $claim=@{requestId=[string]$item.requestId;adObjectGuid=[string]$item.adObjectGuid;claimId=[string]$item.claimId}
   $receiptPath=Join-Path $using:ReceiptDirectory ($item.requestId+'-'+$item.adObjectGuid+'.json')
   function Receipt([string]$State){$json=[pscustomobject]@{RequestId=$item.requestId;AdObjectGuid=$item.adObjectGuid;ComputerName=$item.computerName;Phase=$phase;Status=$State;Reason=$reason;CheckedUtc=[DateTimeOffset]::UtcNow.ToString('o');Evidence=$evidence;ExecutionPolicy=$policyEvidence;Failure=$failure;MeasurementRequested=$false}|ConvertTo-Json -Depth 5;$temporary=$receiptPath+'.'+[Guid]::NewGuid().ToString('N')+'.tmp';[IO.File]::WriteAllText($temporary,$json,[Text.UTF8Encoding]::new($false));[IO.File]::Move($temporary,$receiptPath,$true)}
   function Remote([scriptblock]$Code,[object[]]$Arguments=@(),[int]$Seconds=30){
    $job=Invoke-Command -Session $session -ScriptBlock $Code -ArgumentList $Arguments -AsJob
    try{if(-not (Wait-Job -Job $job -Timeout $Seconds)){throw 'Bounded remote enrollment command timed out.'};Receive-Job -Job $job -ErrorAction Stop}
    finally{if($job.State -eq 'Running'){Stop-Job -Job $job -ErrorAction SilentlyContinue};Remove-Job -Job $job -Force -ErrorAction SilentlyContinue}
   }
   try{
    Receipt 'claimed'
    if($item.computerName -notmatch '^[A-Za-z0-9-]{1,15}$' -or $item.domain -ine 'sccc.edu'){ $reason='identity-mismatch';throw 'Unexpected claimed identity.' }
    Import-Module ActiveDirectory -ErrorAction Stop
    $ad=Get-ADComputer -Identity ([Guid]$item.adObjectGuid) -Server $using:DomainController -Properties DNSHostName,Enabled,OperatingSystem,userAccountControl,primaryGroupID
    if($ad.Name -ine $item.computerName -or -not $ad.Enabled -or $ad.DNSHostName -ine ($item.computerName+'.sccc.edu') -or $ad.ObjectGuid.ToString() -ine $item.adObjectGuid){$reason='identity-mismatch';throw 'Current AD identity mismatch.'}
    if($ad.OperatingSystem -notmatch '^Windows (10|11)(\s|$)' -or ([int64]$ad.userAccountControl -band 4096) -eq 0 -or ([int64]$ad.userAccountControl -band 8192) -ne 0 -or $ad.primaryGroupID -ne 515){$reason='unsupported-windows';throw 'Enabled Windows workstation required.'}
    $phase='private-dns';$reason='private-dns-unavailable';Receipt 'claimed'
    $ips=@(Resolve-DnsName -Name $ad.DNSHostName -Server $using:DnsServer -Type A -DnsOnly -QuickTimeout|Where-Object{$_.Name -ieq $ad.DNSHostName -and $_.Section -eq 'Answer' -and $_.IPAddress}|Select-Object -ExpandProperty IPAddress -Unique)
    if(-not $ips.Count -or @($ips|Where-Object{$_ -notmatch '^10\.' -and $_ -notmatch '^192\.168\.' -and $_ -notmatch '^172\.(1[6-9]|2[0-9]|3[01])\.'}).Count){throw 'Private DNS answer required.'}
    $phase='kerberos';$reason='kerberos-unavailable';Receipt 'claimed'
    $session=New-PSSession -ComputerName $ad.DNSHostName -Authentication Kerberos -SessionOption (New-PSSessionOption -OpenTimeout 5000 -OperationTimeout 60000 -CancelTimeout 1000)
    $phase='endpoint-preflight';$reason='identity-mismatch';Receipt 'claimed'
    $preflight=Remote {
     param($ExpectedName,$ApprovedSigner)
     $ErrorActionPreference='Stop';$system=Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 8;$os=Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 8
     if($env:COMPUTERNAME -ine $ExpectedName -or -not $system.PartOfDomain -or $system.Domain -ine 'sccc.edu' -or $system.DomainRole -ne 1 -or $os.ProductType -ne 1){throw 'Authenticated workstation mismatch.'}
     $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
     if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Authorized administrator token required.'}
     # The installed location is SCCC\Diagnostics, not the earlier publisher's incorrect SCCC-Diagnostics\Agent guard.
     $machinePolicy=(Get-ExecutionPolicy -Scope MachinePolicy).ToString()
     $publisher=Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$ApprovedSigner)
     $policyReason=if($machinePolicy -eq 'Restricted'){'execution-policy-restricted'}elseif($machinePolicy -in @('AllSigned','Undefined')){if(-not $publisher){'trusted-publisher-missing'}}elseif($machinePolicy -notin @('RemoteSigned','Unrestricted')){'execution-policy-review-required'}
     [pscustomobject]@{Existing=((Test-Path -LiteralPath 'C:\ProgramData\SCCC\Diagnostics') -or ($null -ne (Get-ScheduledTask -TaskName 'SCCC Building Diagnostics' -ErrorAction SilentlyContinue)));MachinePolicy=$machinePolicy;TrustedPublisherPresent=[bool]$publisher;SystemUserPolicy='Unknown; not inferred from the remoting user';PolicyReason=$policyReason;PolicyReady=(-not $policyReason)}
    } @($item.computerName,$expectedSigner)
    $policyEvidence=@{MachinePolicy=[string]$preflight.MachinePolicy;SystemUserPolicy=[string]$preflight.SystemUserPolicy;TrustedPublisherPresent=[bool]$preflight.TrustedPublisherPresent;TaskProcessPolicy='AllSigned'}
    if($preflight.Existing){$status='skipped';$reason='existing-configuration-preserved';throw 'Existing protected helper state is retained.'}
    if(-not $preflight.PolicyReady){$status='skipped';$reason=[string]$preflight.PolicyReason;$phase='execution-policy-hold';throw 'Existing machine policy or trusted-publisher state requires review before credential issuance.'}
    $phase='signed-payload-staging';$reason='payload-signature-invalid';Receipt 'claimed'
    $remoteStage=Remote {
     param($RequestId)
     $ErrorActionPreference='Stop';$root='C:\ProgramData\SCCC-Diagnostics'
     function Secure([string]$Path){
      if(Test-Path -LiteralPath $Path){$entry=Get-Item -LiteralPath $Path -Force;if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse staging path rejected.'};$acl=Get-Acl -LiteralPath $Path;if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Unexpected staging owner or inherited ACL.'};foreach($r in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Existing staging ACL is not private.'}};return}
      $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};[void][IO.Directory]::CreateDirectory($Path,$acl);Secure $Path
     }
     Secure $root;$bulk=Join-Path $root 'BulkEnrollment';Secure $bulk;$stage=Join-Path $bulk $RequestId;Secure $stage;$stage
    } @($item.requestId)
    foreach($file in $hashes.Keys){Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $remoteStage $file) -ToSession $session}
    $null=Remote {
     param($Stage,$Signer,$ExpectedHashes)
     foreach($file in $ExpectedHashes.Keys){$path=Join-Path $Stage $file;$sig=Get-AuthenticodeSignature -LiteralPath $path;if($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Thumbprint -ine $Signer -or -not $sig.TimeStamperCertificate -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $ExpectedHashes[$file]){throw 'Remote pinned signature/hash mismatch.'}}
    } @($remoteStage,$expectedSigner,$hashes)
    $phase='protected-installation-parent';$reason='unsafe-installation-path';Receipt 'claimed'
    $null=Remote {
     param($Stage)
     Import-Module (Join-Path $Stage 'Sccc.Diagnostics.psm1') -Force -ErrorAction Stop
     $parent='C:\ProgramData\SCCC'
     if(-not (Test-Path -LiteralPath $parent)){
      $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
      foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
      [void][IO.Directory]::CreateDirectory($parent,$acl)
     }
     Test-DiagnosticsParentPath -Path $parent
    } @($remoteStage)
    $phase='one-time-credential-delivery';$reason='credential-delivery-unknown';$credentialAttempted=$true;Receipt 'claimed'
    # This one-time response is never retried automatically or written to a receipt.
    $credential=Invoke-RestMethod -Uri ($apiOrigin+'/api/building-diagnostics/devices/bulk-enrollment/worker/provision') -Method Post -Headers $authorization -ContentType 'application/json' -Body ($claim|ConvertTo-Json -Compress) -MaximumRedirection 0 -TimeoutSec 30
    if($credential.computerName -ine $item.computerName -or $credential.domain -ine 'sccc.edu' -or $credential.deviceToken -cnotmatch '^sccc-diag\.[A-Za-z0-9_-]{43}$'){throw 'Unverified one-time credential response.'}
    $config=@{serverUrl=$apiOrigin;deviceId=[string]$credential.deviceId;deviceToken=[string]$credential.deviceToken;computerName=[string]$item.computerName;domain='sccc.edu';externalProbeOrigin=$using:externalOrigin;permitSustained=$false}|ConvertTo-Json -Compress
    $phase='install-reporting-helper';$reason='installation-failed';Receipt 'installing'
    $proof=Remote {
     param($Stage,$ConfigJson,$Signer,$ExpectedHashes)
     $ErrorActionPreference='Stop';$path=Join-Path $Stage 'device.json'
     $inputCreated=$false
     $fileAcl=[Security.AccessControl.FileSecurity]::new();$fileAcl.SetAccessRuleProtection($true,$false);$fileAcl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));foreach($sid in @('S-1-5-18','S-1-5-32-544')){$fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))}
     try{
      $stream=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$fileAcl)
      $inputCreated=$true
      try{$writer=[IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false));try{$writer.Write($ConfigJson);$writer.Flush()}finally{$writer.Dispose()}}finally{$stream.Dispose()}
      & (Join-Path $Stage 'Install-DiagnosticsAgent.ps1') -ProvisioningFile $path -ExpectedDomain 'sccc.edu' -SignerThumbprint $Signer -Activate | Out-Null
      if(-not $?){throw 'Signed helper installation failed.'}
      foreach($file in @('Invoke-DiagnosticsAgent.ps1','Sccc.Diagnostics.psm1','ExternalProbe.dll')){$installed=Join-Path 'C:\ProgramData\SCCC\Diagnostics' $file;$signature=Get-AuthenticodeSignature -LiteralPath $installed;if((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ine $ExpectedHashes[$file] -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $Signer){throw 'Installed pinned payload read-back failed.'}}
      Start-Sleep -Seconds 3
      $task=Get-ScheduledTask -TaskName 'SCCC Building Diagnostics' -ErrorAction Stop
      $system=($task.Principal.UserId -in @('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM'))
      $expectedRunner='C:\ProgramData\SCCC\Diagnostics\Invoke-DiagnosticsAgent.ps1'
      $action=@($task.Actions)[0]
      if(-not $system -or $task.State -ne 'Running' -or $action.Execute -ine (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -or $action.Arguments -cne ('-NoProfile -NonInteractive -ExecutionPolicy AllSigned -File "'+$expectedRunner+'"')){throw 'Managed SYSTEM helper task did not verify running.'}
      [pscustomobject]@{taskRunning=$true;taskSystem=$true;helperVersion='1.1.0-rc1';signerThumbprint=$Signer;payloadSha256=(Get-FileHash -LiteralPath 'C:\ProgramData\SCCC\Diagnostics\ExternalProbe.dll' -Algorithm SHA256).Hash}
     }finally{$ConfigJson=$null;if($inputCreated -and (Test-Path -LiteralPath $path)){Remove-Item -LiteralPath $path -Force}}
    } @($remoteStage,$config,$expectedSigner,$hashes) 120
    $evidence=@{taskRunning=[bool]$proof.taskRunning;taskSystem=[bool]$proof.taskSystem;helperVersion=[string]$proof.helperVersion;signerThumbprint=[string]$proof.signerThumbprint;payloadSha256=[string]$proof.payloadSha256}
    $status='installed';$reason='installed-awaiting-check-in';$phase='installed-task-verified'
   }catch{
    $failure=@{ErrorType=$_.Exception.GetType().FullName;ErrorId=[string]$_.FullyQualifiedErrorId;FailureLine=$_.InvocationInfo.ScriptLineNumber;FailureScript=[string]$_.InvocationInfo.ScriptName}
    if($status -ne 'skipped' -and $reason -in @('private-dns-unavailable','kerberos-unavailable')){$status='unreachable'}
    # Do not log raw exception/request/config objects: remoting/HTTP errors can include credentials.
   }finally{
    $credential=$null;$config=$null
    Receipt $status
    try{$body=$claim.Clone();$body.status=$status;$body.reason=$reason;if($evidence){$body.evidence=$evidence};$null=Invoke-RestMethod -Uri ($apiOrigin+'/api/building-diagnostics/devices/bulk-enrollment/worker/result') -Method Post -Headers $authorization -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 5 -Compress) -MaximumRedirection 0 -TimeoutSec 30}catch{Write-Warning ('Enrollment result delivery needs review for '+$item.computerName+'; the protected receipt was retained. No automatic retry was attempted.')}
    if($session){Remove-PSSession -Session $session -ErrorAction SilentlyContinue}
   }
  } -ThrottleLimit 4
  if($Watch){Start-Sleep -Seconds 30}
 }while($Watch)
}finally{$headers.Clear();$workerToken=$null}
