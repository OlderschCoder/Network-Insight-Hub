#Requires -Version 7.2
#Requires -RunAsAdministrator
# Finite resume of the two reviewed existing queues. Derived from frozen controller 091B89F3...366DB.
# Never creates or transfers the existing worker credential, stages local payloads, or changes gates/GPO/MFA.
[CmdletBinding()]
param([switch]$Execute)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$FredOrigin='https://app-server2.centralus.cloudapp.azure.com'
$controllerRoot='C:\ProgramData\SCCC-DiagnosticsBulkController'
$WorkerCredentialPath=Join-Path $controllerRoot 'worker.dpapi'
$AgentSourceDirectory=Join-Path $controllerRoot 'payload'
$ReceiptDirectory=Join-Path $controllerRoot 'receipts'
$DomainController='ad-sc00.sccc.edu';$DnsServer='10.40.1.77'
$approvedRequests=@('d682388d-edf3-4563-bde8-0897d78eb6b0','60388620-b895-4ae9-b6b0-e4b3a4c9b417')
$maximumTargets=255;$remainingBefore=255;$consumed=0;$batchCount=0
$seenTargets=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$deliveryHolds=[Collections.Concurrent.ConcurrentBag[string]]::new()
$runClock=[Diagnostics.Stopwatch]::StartNew()
if($env:COMPUTERNAME -ine 'LP-AA152MB-01' -or [Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-21-4013532473-1306839332-4181249023-66686'){throw 'Reviewed operator workstation/account required.'}
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
function Assert-ExistingPrivateFile([string]$Path){
 Assert-NoReparse $Path
 if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw 'Existing protected file is required; resume cannot stage missing files.'}
 $acl=Get-Acl -LiteralPath $Path
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Protected file owner did not verify.'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')){throw 'Protected file grants unexpected access.'}}
}
function Test-ScopedResumeBatch($Batch,[string[]]$Requests,[int]$Before,[int]$Consumed,[Collections.Generic.HashSet[string]]$Seen){
 if(-not $Batch.PSObject.Properties['scope'] -or -not $Batch.PSObject.Properties['items']){throw 'Scoped claim response is required; the backend filter must be deployed first.'}
 $actual=@($Batch.scope.requestIds|ForEach-Object{([string]$_).ToLowerInvariant()}|Sort-Object -Unique)
 if(($actual -join ',') -cne (($Requests|Sort-Object -Unique) -join ',')){throw 'Claim response scope changed.'}
 $left=$Batch.scope.queuedRemaining
 if(($left -isnot [int] -and $left -isnot [long]) -or $left -lt 0 -or $left -gt $Before){throw 'Selected queued count increased or is invalid.'}
 $items=@($Batch.items)
 if($items.Count -gt 4 -or ($Consumed+$items.Count) -gt 255 -or $left -gt ($Before-$items.Count)){throw 'Finite selected queue bounds did not verify.'}
 if($Batch.measurementsQueued -ne $false -or $Batch.policy.permitSustained -ne $false){throw 'Enrollment-only policy did not verify.'}
 $pending=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
 foreach($item in $items){
  $request=([string]$item.requestId).ToLowerInvariant();$guid=[Guid]::Empty
  if($request -notin $Requests -or -not [Guid]::TryParse([string]$item.adObjectGuid,[ref]$guid) -or $Seen.Contains($guid.ToString()) -or -not $pending.Add($guid.ToString())){throw 'Foreign, invalid or repeated AD identity in scoped claim.'}
 }
 if($items.Count -eq 0 -and $left -eq $Before -and $left -gt 0){throw 'Selected queue is blocked by existing claims; hold for review.'}
 foreach($target in $pending){[void]$Seen.Add($target)}
 return [pscustomobject]@{QueuedRemaining=[int]$left;ClaimedCount=$items.Count}
}
Assert-Private $controllerRoot
$oldController=Join-Path $controllerRoot 'Invoke-BulkDiagnosticsEnrollment.ps1'
Assert-ExistingPrivateFile $oldController
if((Get-FileHash -LiteralPath $oldController -Algorithm SHA256).Hash -cne '091B89F3F72E5270FA010F372379BC0E7E10B559B5CF733EA7B2C0B4B6B366DB'){throw 'Existing reviewed controller baseline drifted.'}
Assert-Private $AgentSourceDirectory
foreach($entry in $payloadHashes.GetEnumerator()){
 $path=Join-Path $AgentSourceDirectory $entry.Key;Assert-ExistingPrivateFile $path
 $signature=Get-AuthenticodeSignature -LiteralPath $path
 if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $entry.Value -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $signer -or -not $signature.TimeStamperCertificate){throw 'Pinned reviewed diagnostics payload validation failed.'}
}
Assert-Private $WorkerCredentialPath
Assert-Private (Split-Path -Parent ([IO.Path]::GetFullPath($WorkerCredentialPath)))
Assert-Private $ReceiptDirectory
if(-not $Execute){[pscustomobject]@{Status='ValidatedNotStarted';ApprovedRequestIds=$approvedRequests;MaximumTargets=255;CredentialRegenerated=$false;MeasurementsRequested=$false};return}
$other=Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'"|Where-Object{$_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)-File\s+(?:"[^"]*|[^\s]*)(?:Start-ReviewedBulkController|Invoke-BulkDiagnosticsEnrollment|Resume-ScopedDiagnosticsEnrollment)\.ps1'}
if($other){throw 'Another reviewed bulk controller process is active; no parallel resume.'}
$mutex=[Threading.Mutex]::new($false,'Global\SCCC.Diagnostics.BulkScopedResume.v1');$locked=$false
try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
if(-not $locked){$mutex.Dispose();throw 'Another scoped resume is active.'}
$headers=@{};$workerToken=$null;$clear=$null
try{
 Add-Type -AssemblyName System.Security
 $clear=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($WorkerCredentialPath),$null,[Security.Cryptography.DataProtectionScope]::LocalMachine)
 try{$workerToken=[Text.Encoding]::UTF8.GetString($clear)}finally{[Array]::Clear($clear,0,$clear.Length);$clear=$null}
 if($workerToken.Length -lt 32 -or $workerToken -match '\s'){throw 'A protected dedicated worker credential is required.'}
 $headers=@{Authorization='Bearer '+$workerToken}
 do{
  if($runClock.Elapsed.TotalHours -gt 6 -or $batchCount -ge 256){throw 'Finite resume deadline reached; retain remaining queue for review.'}
  $batch=Invoke-RestMethod -Uri ($FredOrigin+'/api/building-diagnostics/devices/bulk-enrollment/worker/claim') -Method Post -Headers $headers -ContentType 'application/json' -Body (@{workerId=$env:COMPUTERNAME;requestIds=$approvedRequests}|ConvertTo-Json -Compress) -MaximumRedirection 0 -TimeoutSec 30
  $verified=Test-ScopedResumeBatch $batch $approvedRequests $remainingBefore $consumed $seenTargets
  $remainingBefore=$verified.QueuedRemaining;$consumed+=$verified.ClaimedCount;$batchCount++
  $externalOrigin=[string]$batch.policy.externalProbeOrigin
  if($externalOrigin){$external=[Uri]$externalOrigin;if(-not $external.IsAbsoluteUri -or $external.Scheme -ne 'https' -or -not $external.IsDefaultPort -or $external.HostNameType -ne 'Dns' -or $external.UserInfo -or $external.Query -or $external.Fragment -or $external.AbsolutePath -ne '/'){throw 'The reviewed server external-origin policy did not validate.'}}
  @($batch.items)|ForEach-Object -Parallel {
   Set-StrictMode -Version Latest
   $ErrorActionPreference='Stop'
    $item=$_;$session=$null;$credential=$null;$phase='directory';$reason='installation-failed';$status='failed';$evidence=$null;$policyEvidence=$null;$failure=$null;$credentialAttempted=$false;$remoteStage=$null;$holds=$using:deliveryHolds
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
    if($credentialAttempted -and $phase -eq 'one-time-credential-delivery'){$holds.Add([string]$item.adObjectGuid)}
    $failure=@{ErrorType=$_.Exception.GetType().FullName;ErrorId=[string]$_.FullyQualifiedErrorId;FailureLine=$_.InvocationInfo.ScriptLineNumber;FailureScript=[string]$_.InvocationInfo.ScriptName}
    if($status -ne 'skipped' -and $reason -in @('private-dns-unavailable','kerberos-unavailable')){$status='unreachable'}
    # Do not log raw exception/request/config objects: remoting/HTTP errors can include credentials.
   }finally{
    $credential=$null;$config=$null
    Receipt $status
    try{$body=$claim.Clone();$body.status=$status;$body.reason=$reason;if($evidence){$body.evidence=$evidence};$null=Invoke-RestMethod -Uri ($apiOrigin+'/api/building-diagnostics/devices/bulk-enrollment/worker/result') -Method Post -Headers $authorization -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 5 -Compress) -MaximumRedirection 0 -TimeoutSec 30}catch{$holds.Add([string]$item.adObjectGuid);Write-Warning ('Enrollment result delivery needs review for '+$item.computerName+'; the protected receipt was retained. No automatic retry was attempted.')}
    if($session){Remove-PSSession -Session $session -ErrorAction SilentlyContinue}
   }
  } -ThrottleLimit 4
  if(-not $deliveryHolds.IsEmpty){throw 'One-time credential or result delivery is uncertain; retain protected receipts and stop without replay.'}
  if($remainingBefore -gt 0){Start-Sleep -Seconds 2}
 }while($remainingBefore -gt 0)
 [pscustomobject]@{Status='SelectedQueuesDrained';ApprovedRequestIds=$approvedRequests;ClaimedTargets=$consumed;Batches=$batchCount;QueuedRemaining=0;MeasurementsRequested=$false;ForeignRequestsClaimed=$false}
}finally{$headers.Clear();$workerToken=$null;if($clear){[Array]::Clear($clear,0,$clear.Length)};if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}

# SIG # Begin signature block
# MII9agYJKoZIhvcNAQcCoII9WzCCPVcCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCDMvaApv+i3/GJ4
# +cE6ixrb6YssY47nxiU1S+4cnbWR/aCCIiwwggXMMIIDtKADAgECAhBUmNLR1FsZ
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
# 03u4aUoqlmZpxJTG9F9urJh4iIAGXKKy7aIwggbDMIIEq6ADAgECAhMzAAk2cZ1g
# NlbH3TaFAAAACTZxMA0GCSqGSIb3DQEBDAUAMFoxCzAJBgNVBAYTAlVTMR4wHAYD
# VQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29mdCBJ
# RCBWZXJpZmllZCBDUyBFT0MgQ0EgMDQwHhcNMjYxMDI1MDgxMjM0WhcNMjYxMDI4
# MDgxMjM0WjCBhDELMAkGA1UEBhMCVVMxDzANBgNVBAgTBkthbnNhczEQMA4GA1UE
# BxMHTGliZXJhbDEoMCYGA1UEChMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29s
# bGVnZTEoMCYGA1UEAxMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29sbGVnZTCC
# AaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBALH+6buKY7Wn3qy15UDjrUpR
# JdnUhjdQpVyvMogQx3GWsfxrR3KGYhhJmLorq1gYQVEW1cuptV9NIlKJoREzNNhN
# Yh6qBP5Uo6SuWuzSfPUNBMKpU7KEiJZR/u+sdBn1kVmanC0tbK3RWiU6qd5Tk7DI
# dxKV5EYdRAdr2d6evzwh0c5zdAsIawzWAgbJDM/xu1uIzt0mvhOVHbJn5ZGFVSVF
# OnR+Zwc9tKuNb9evm32uRe9ufvdbFFYO6KWLvbmcJQf8ibvLS0pXb29Hz4Nd6Uuz
# N/k36Ou5FL0Cgp27b63z4+OtoHIk1y0CrXn3IjJQRooz1BDl/SitvrgSCleoScBA
# zat6OOx0eTv+B2MpIR2DZ6E739h+9xjdn+HC6m+I8BtO8wA1WFQhMvAyTGH5mKjQ
# xTOXA6VO6DKglnW5ny/+2+E+VhTFhEOG/YH1rTecd/+s0bC0z8jmSkTmkomO6boA
# P+9xU+V8x51bnKoPG6CSu8bfpy27UBSpYcydTu2ZFwIDAQABo4IB1TCCAdEwDAYD
# VR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwPAYDVR0lBDUwMwYKKwYBBAGCN2EB
# AAYIKwYBBQUHAwMGGysGAQQBgjdhgpKQiVaC9aWRWIK4/vAosum1djAdBgNVHQ4E
# FgQUXkJCWzL6J3gdSFdLabzWqxqlSCUwHwYDVR0jBBgwFoAUmvFUd3UMhxY3RqCs
# 3nn59H/BeOkwZwYDVR0fBGAwXjBcoFqgWIZWaHR0cDovL3d3dy5taWNyb3NvZnQu
# Y29tL3BraW9wcy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENTJTIw
# RU9DJTIwQ0ElMjAwNC5jcmwwdAYIKwYBBQUHAQEEaDBmMGQGCCsGAQUFBzAChlho
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDUyUyMEVPQyUyMENBJTIwMDQuY3J0MFQGA1UdIARN
# MEswSQYEVR0gADBBMD8GCCsGAQUFBwIBFjNodHRwOi8vd3d3Lm1pY3Jvc29mdC5j
# b20vcGtpb3BzL0RvY3MvUmVwb3NpdG9yeS5odG0wDQYJKoZIhvcNAQEMBQADggIB
# ADSJYV3n+RoFZOzk36JwY4XtgspqLdr1Zr5BGEY56Ssyq8KPEz0B/240cNC/1wch
# C8M9veQeJDdwa77xsghLe4NFE2Lq7To+qm9fOXpmq8n/JI2GjQMUCHkadNPrP1hK
# ahpdppLOE0V9dSCojocgEDjo64IbhKSZD9DENRbUCeRWwSQuI05cqQLZPjtngL+V
# og7430WMppCtSY5kj1sLT8AjFn8OylcRD/HbwBdnEOdHaOtORougs1zOtnSzapwG
# uG6p3h7C6cAwRiZIooqvlfuZRRYCC4zQtnqNS/1pM0y6J1XoPnOH/ulhK9SIQITo
# pTtzOyqvluTaKRLmCEY3y9elTlcFunIRtih10InMzG0H16KOsQg7arH9bRHiw6dI
# S3Q30MMbegfE10h8PekvpEmh3ZvnjsVV8gStAIa4pAJopqz66owDzWYYTR0ts+Kf
# kbZ2f4PiMVOJJ2CATXMxVS1rV+Ik0J2jtW8VhanLBVkRmtsgbTYkKWAcaTiigSX3
# BSZkwwCCE0Ktd9YtxKCfhHqSRUHMZP9XqFXZV/ERmDjtxt52JbszBGTmOxQIyL38
# /6maTYlP876u+Q0TVSGWP6Mw+yB/uPPfeUOs2w2NQcCiwL/4qItMCIIQk83Jokhu
# 38RnE6pQtvi8TT+7M8PaxKuPPGAuW1JVhMhzxb++MSalMIIGwzCCBKugAwIBAgIT
# MwAJNnGdYDZWx902hQAAAAk2cTANBgkqhkiG9w0BAQwFADBaMQswCQYDVQQGEwJV
# UzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSswKQYDVQQDEyJNaWNy
# b3NvZnQgSUQgVmVyaWZpZWQgQ1MgRU9DIENBIDA0MB4XDTI2MTAyNTA4MTIzNFoX
# DTI2MTAyODA4MTIzNFowgYQxCzAJBgNVBAYTAlVTMQ8wDQYDVQQIEwZLYW5zYXMx
# EDAOBgNVBAcTB0xpYmVyYWwxKDAmBgNVBAoTH1Nld2FyZCBDb3VudHkgQ29tbXVu
# aXR5IENvbGxlZ2UxKDAmBgNVBAMTH1Nld2FyZCBDb3VudHkgQ29tbXVuaXR5IENv
# bGxlZ2UwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQCx/um7imO1p96s
# teVA461KUSXZ1IY3UKVcrzKIEMdxlrH8a0dyhmIYSZi6K6tYGEFRFtXLqbVfTSJS
# iaERMzTYTWIeqgT+VKOkrlrs0nz1DQTCqVOyhIiWUf7vrHQZ9ZFZmpwtLWyt0Vol
# OqneU5OwyHcSleRGHUQHa9nenr88IdHOc3QLCGsM1gIGyQzP8btbiM7dJr4TlR2y
# Z+WRhVUlRTp0fmcHPbSrjW/Xr5t9rkXvbn73WxRWDuili725nCUH/Im7y0tKV29v
# R8+DXelLszf5N+jruRS9AoKdu2+t8+PjraByJNctAq159yIyUEaKM9QQ5f0orb64
# EgpXqEnAQM2rejjsdHk7/gdjKSEdg2ehO9/YfvcY3Z/hwupviPAbTvMANVhUITLw
# Mkxh+Zio0MUzlwOlTugyoJZ1uZ8v/tvhPlYUxYRDhv2B9a03nHf/rNGwtM/I5kpE
# 5pKJjum6AD/vcVPlfMedW5yqDxugkrvG36ctu1AUqWHMnU7tmRcCAwEAAaOCAdUw
# ggHRMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMDwGA1UdJQQ1MDMGCisG
# AQQBgjdhAQAGCCsGAQUFBwMDBhsrBgEEAYI3YYKSkIlWgvWlkViCuP7wKLLptXYw
# HQYDVR0OBBYEFF5CQlsy+id4HUhXS2m81qsapUglMB8GA1UdIwQYMBaAFJrxVHd1
# DIcWN0agrN55+fR/wXjpMGcGA1UdHwRgMF4wXKBaoFiGVmh0dHA6Ly93d3cubWlj
# cm9zb2Z0LmNvbS9wa2lvcHMvY3JsL01pY3Jvc29mdCUyMElEJTIwVmVyaWZpZWQl
# MjBDUyUyMEVPQyUyMENBJTIwMDQuY3JsMHQGCCsGAQUFBwEBBGgwZjBkBggrBgEF
# BQcwAoZYaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNy
# b3NvZnQlMjBJRCUyMFZlcmlmaWVkJTIwQ1MlMjBFT0MlMjBDQSUyMDA0LmNydDBU
# BgNVHSAETTBLMEkGBFUdIAAwQTA/BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNy
# b3NvZnQuY29tL3BraW9wcy9Eb2NzL1JlcG9zaXRvcnkuaHRtMA0GCSqGSIb3DQEB
# DAUAA4ICAQA0iWFd5/kaBWTs5N+icGOF7YLKai3a9Wa+QRhGOekrMqvCjxM9Af9u
# NHDQv9cHIQvDPb3kHiQ3cGu+8bIIS3uDRRNi6u06PqpvXzl6ZqvJ/ySNho0DFAh5
# GnTT6z9YSmoaXaaSzhNFfXUgqI6HIBA46OuCG4SkmQ/QxDUW1AnkVsEkLiNOXKkC
# 2T47Z4C/laIO+N9FjKaQrUmOZI9bC0/AIxZ/DspXEQ/x28AXZxDnR2jrTkaLoLNc
# zrZ0s2qcBrhuqd4ewunAMEYmSKKKr5X7mUUWAguM0LZ6jUv9aTNMuidV6D5zh/7p
# YSvUiECE6KU7czsqr5bk2ikS5ghGN8vXpU5XBbpyEbYoddCJzMxtB9eijrEIO2qx
# /W0R4sOnSEt0N9DDG3oHxNdIfD3pL6RJod2b547FVfIErQCGuKQCaKas+uqMA81m
# GE0dLbPin5G2dn+D4jFTiSdggE1zMVUta1fiJNCdo7VvFYWpywVZEZrbIG02JClg
# HGk4ooEl9wUmZMMAghNCrXfWLcSgn4R6kkVBzGT/V6hV2VfxEZg47cbediW7MwRk
# 5jsUCMi9/P+pmk2JT/O+rvkNE1Uhlj+jMPsgf7jz33lDrNsNjUHAosC/+KiLTAiC
# EJPNyaJIbt/EZxOqULb4vE0/uzPD2sSrjzxgLltSVYTIc8W/vjEmpTCCBygwggUQ
# oAMCAQICEzMAAAAXJ0UJC4uHr8YAAAAAABcwDQYJKoZIhvcNAQEMBQAwYzELMAkG
# A1UEBhMCVVMxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjE0MDIGA1UE
# AxMrTWljcm9zb2Z0IElEIFZlcmlmaWVkIENvZGUgU2lnbmluZyBQQ0EgMjAyMTAe
# Fw0yNjAzMjYxODExMzFaFw0zMTAzMjYxODExMzFaMFoxCzAJBgNVBAYTAlVTMR4w
# HAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29m
# dCBJRCBWZXJpZmllZCBDUyBFT0MgQ0EgMDQwggIiMA0GCSqGSIb3DQEBAQUAA4IC
# DwAwggIKAoICAQCCx2T+Aw9mKgGVzJ+Tq0PMn49G3itIsYpbx7ClLSRHFe1RELdP
# cZ1sIqWOhsSfy6yyqEapClGH9Je9FXA1cQgZvvpQbkg+QInVLr/0EPrVBCwrM96l
# bRI2PxNeCwXG9LsyW2hG6KQgintDmNCBo4zpDIr377plVdSliZm6UB7rHwmvBnR0
# 2QT6tnrqWq2ihzB6lRJVTEzuh0OafzIMeMnYM0+x+ve5EOLHdfiq+HXiMf9Jb7YL
# HtYgyHIiJA7bTWLqFSLGaTh7ZlbxbsLXA91OOroEpv7OjzFuu3tkpC9FflA4Dp2E
# uq4+qPmxUqfGp+TX0gLRJp9NJOzzILjcTD3rkFFFbxUv1xyg6avivFDLtoKBhM2T
# d138umE1pNOacanuSYtPHIeQHmB6haFi64avLBLwTTAm/Rbit860cFXR72wq+5Qh
# 4hSmezHqKXERWPpVBe+APrJ4Iqc+aPeMmIkoCWZQO22HnLNFUFSXjiwyIbgvlH/L
# IAJEqTafTzxDZgKhlLU7zr6gwsq3WNpcYQI6NuxWnwh3VVDDyF7onQqKs5Ll7ble
# VN0Y8VvqgE45ppyBbvwqN/Run5fMCCRz3aYMY0kZhKO92eP7t4zHqZ5bQMAgZ0tE
# 2Pz/jb0wiykUF/PcoOqqk3vVLiRDYst6vd3GEMNzMpUUvQcvBG46+COIbwIDAQAB
# o4IB3DCCAdgwDgYDVR0PAQH/BAQDAgGGMBAGCSsGAQQBgjcVAQQDAgEAMB0GA1Ud
# DgQWBBSa8VR3dQyHFjdGoKzeefn0f8F46TBUBgNVHSAETTBLMEkGBFUdIAAwQTA/
# BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9Eb2Nz
# L1JlcG9zaXRvcnkuaHRtMBkGCSsGAQQBgjcUAgQMHgoAUwB1AGIAQwBBMBIGA1Ud
# EwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAU2UEpsA8PY2zvadf1zSmepEhqMOYw
# cAYDVR0fBGkwZzBloGOgYYZfaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9w
# cy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENvZGUlMjBTaWduaW5n
# JTIwUENBJTIwMjAyMS5jcmwwfQYIKwYBBQUHAQEEcTBvMG0GCCsGAQUFBzAChmFo
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDb2RlJTIwU2lnbmluZyUyMFBDQSUyMDIwMjEuY3J0
# MA0GCSqGSIb3DQEBDAUAA4ICAQCQdVoZ/U0m38l2iKaZFlsxavptpoOLyaR1a9ZK
# 2TSF1kOnFJhMDse6KkCgsveoiEjXTVc6Xt86IKHn76Nk5qZB0BXv2iMRQ2giAJmY
# vZcmstoZqfB2M3Kd5wnJhUJOtF/b6HsqSelY6nhrF06zor1lDmDQixBZcLB9zR1+
# RKQso1jekNxYuUk+HaN3k1S57qk0O//YbkwU0mELCW04N5vICMZx5T5c7Nq/7uLv
# bVhCdD7f2bZpA4U7vOkB1ooB4AaER3pjoJ0Mad5LFyi6Na9p9Zu/hrLeOjU5FItS
# 5YxsqvlfXxAThJ176CmkYstKRmytSHZ7JhKRfV6e9Zftk/ODb/CK4pGVAVqsOf43
# 37bQGrOHHCQ3IvN9gmnUuDh8JdvbheoWPHxIN1GB5sUiY584tXN7xdD8LCSsRqJv
# Q8e7a3gZWTgViugRs1QWq+N0G9Nje6JHlN1CjJehge+H5PGktJja+juGEr0P+ukS
# kcL6qaZxFQTh3SDI71lvW++3bl/Ezd6SO8N9Udw+reoyvRHCyTiSsplZQSBTVJdP
# mo3qCpGuyHFtPo5CBn3/FPTiqJd3M9BHoqKd0G9Kmg6fGcAvFwnLNXA2kov727wR
# ljL3ypfqL7iAT/Ynpxul6RwHRlcOf9dDGg1RRvr92NP/CWVXIb68geR2rvU/Nsfm
# tjF1wDCCB54wggWGoAMCAQICEzMAAAAHh6M0o3uljhwAAAAAAAcwDQYJKoZIhvcN
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
# b24xKzApBgNVBAMTIk1pY3Jvc29mdCBJRCBWZXJpZmllZCBDUyBFT0MgQ0EgMDQC
# EzMACTZxnWA2VsfdNoUAAAAJNnEwDQYJYIZIAWUDBAIBBQCgXjAQBgorBgEEAYI3
# AgEMMQIwADAZBgkqhkiG9w0BCQMxDAYKKwYBBAGCNwIBBDAvBgkqhkiG9w0BCQQx
# IgQgS+Iu1RrpK9iGgXK0paLr1GIGlIKIhMB7L8fqtuDhLoUwDQYJKoZIhvcNAQEB
# BQAEggGAOA2hmqBpFf6VmPfLENhe25yoymcwzVZR+TbxWysyL17Xc3uxoLHm4f+Y
# MJ2264rHlFM1BWcCG4Sw7JCzd2KwXNJeE6xOZF24M2Her6JpTBnOSjm8i0Q/YLls
# Rwvt2xmeD7Spo197j390uiQUlGDQMsBVJy7ARxCDQxAjohdLPj5p+/hBBHQiEF+c
# sypkge8wivMJIVpRBJY/mOK/ICzSKkO2+CVbeinPULTqnp84fbQ8+6dMoartTi0V
# bZe1+7cLrWJ2WzaNw5YTSw0nKFZ+7Yl6pk8MIPVZ+HEDuVjQcaaBKJq62N4wxlrG
# HzAWHvJ9X0BNc576qK1kxR6kYmrxsGPw0X3Qsy48DUGJDaTuMp6Xp1vuZzWKMSm6
# 9M+xC23bItL9MWAglwfupkMP0v+DPxz+bhYmbHMYrgU2QYD2Rn8DJqF//hrYQJsJ
# BumBMqB1ZUIzsAcwVi2sOGzgrNEebNZjZzOc7L+F/RyS04jzxH6hpe19/kfQA9co
# HFk4R23XoYIYFDCCGBAGCisGAQQBgjcDAwExghgAMIIX/AYJKoZIhvcNAQcCoIIX
# 7TCCF+kCAQMxDzANBglghkgBZQMEAgEFADCCAWIGCyqGSIb3DQEJEAEEoIIBUQSC
# AU0wggFJAgEBBgorBgEEAYRZCgMBMDEwDQYJYIZIAWUDBAIBBQAEIBaUL55671aD
# HFi1h024dk3hx24OvvoGUUHGmK2bgSMjAgZq2055HmQYEzIwMjYxMDI3MDcyOTIx
# LjE1NVowBIACAfSggeGkgd4wgdsxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNo
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
# hkiG9w0BCQUxDxcNMjYxMDI3MDcyOTIxWjAvBgkqhkiG9w0BCQQxIgQgKnZAb70h
# c+5lEBdJGdkWqsDaREDRNHPC6Phs6S0BtiMwgbkGCyqGSIb3DQEJEAIvMYGpMIGm
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
# wBJ1bzYaV7HN3scYJcKHwCx/c91gRDnIDkw5MA0GCSqGSIb3DQEBAQUABIICACcw
# QX7Zd5bK3zCqBGOTLx2PPSyg1xlr8Jfo3na6RZRIwEsNdJsDwvcMN3DKZI2zp3TQ
# Tfi7YbOWec2YQbg9y4ZpB7GCKOJmBU6FcyFX1f06Y4GMTKixaUmAVrcKSFtcA3bA
# rrh1ZDRfPNFYLjo67+qfycQklnn4nVe+xhROnCPQDJpl3dYOi20gSXbHAn3toPL6
# xzw0OsrHA5iXrdVuMMmmuhCg8tDPkvkEle0su0XRTahVmfujeDEM9PVgmhyQQwzA
# +eFNsa4ithvEZXQ+MWCWwVgARCIXXqCHzUsnJs9VEBNY1Kt/z2iKqLmvfigagzp0
# QnWOHzEgb+OM84+c9xjsTYnzcajgJck9e1eyMcg+rlFW10IhEPYTDNG9zORyvBCb
# ENKO3Hx5o98UupN9N8EpuYaGsvZ8RfHxLMl2gi75p6LbHcFVWJRElp5AvxTJwRlq
# dpOqrIfamBLDNOtxkL8jS47GivbIksWBeufvb+itkStShgttPc+o2hJIfqKGG2iK
# UcVjcO3w7T8Xb77ub2qBd8nejMpXiLX7VN8CdHdYbcMTfASfdAm1V3b+kA24IIyH
# Mf4S7I2iJXrJbaONWMlj4j0xL6+xVgy9QBDAViwbBlwKIFMysIENFFqOPtHX5Skf
# EwA/cgMuIFZ2xhq13xilEiw22GVJCoTVtXFeRUX+
# SIG # End signature block
