#Requires -Version 7.2
#Requires -RunAsAdministrator
# Finite enrollment-only controller for a single reviewed Fred request using diagnostics agent 1.2.1.
# Never creates or transfers the existing worker credential and never queues measurements or changes GPO/MFA.
[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$RequestId,
 [ValidateRange(1,1000)][int]$MaximumTargets=400,
 [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$FredOrigin='https://app-server2.centralus.cloudapp.azure.com'
$controllerRoot='C:\ProgramData\SCCC-DiagnosticsBulkController'
$WorkerCredentialPath=Join-Path $controllerRoot 'worker.dpapi'
$AgentSourceDirectory=Join-Path $controllerRoot 'payload-1.2.1'
$ReceiptDirectory=Join-Path $controllerRoot 'receipts'
$DomainController='ad-sc00.sccc.edu';$DnsServer='10.40.1.77'
$parsedRequest=[Guid]::Empty
if(-not [Guid]::TryParse($RequestId,[ref]$parsedRequest)){throw 'A valid reviewed enrollment request ID is required.'}
$approvedRequests=@($parsedRequest.ToString().ToLowerInvariant())
$remainingBefore=$MaximumTargets;$consumed=0;$batchCount=0
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
$signer='FC6B8438BA075C09EFD82677C5A7C5CBFE464D1E'
$signerSubject='CN=Seward County Community College, O=Seward County Community College, L=Liberal, S=Kansas, C=US'
$payloadHashes=@{
 'Install-DiagnosticsAgent.ps1'='4050CAA3FE897207C3EEAC19D466EF2D4FD8F0AFF4F4BF2563F135DFF18AFCDB'
 'Invoke-DiagnosticsAgent.ps1'='ACF8CD911E62315AEE37F94C1E593BDD4F58A72B3921F3CA781EF5163F73455C'
 'Sccc.Diagnostics.psm1'='6E46E69B257EF2B8D60A1C4BDC6C626A4154B93571B0099C328A84368CF70845'
 'ExternalProbe.dll'='15FE90D6284C1C188AE99199F1A51DFA14A2D6DBBED6575254C368D8E42133F6'
 'SCCC-Diagnostics-Signer.cer'='272028E10E7EFAB94DCBC83C5FE9ACB87F1F3E7D6E41ED45B245A3B2993C32C7'
 'LibreSpeed\librespeed-cli.exe'='5E01DF3986486419FEE84238204C3030FBBBE2E3145D4A2F5EF5EBCBAD7598D4'
 'LibreSpeed\LICENSE'='E3A994D82E644B03A792A930F574002658412F62407F5FEE083F2555C5F23118'
}
$signedPayloads=@('Install-DiagnosticsAgent.ps1','Invoke-DiagnosticsAgent.ps1','Sccc.Diagnostics.psm1','ExternalProbe.dll')
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
function Test-ScopedResumeBatch($Batch,[string[]]$Requests,[int]$Before,[int]$Consumed,[int]$Limit,[Collections.Generic.HashSet[string]]$Seen){
 if(-not $Batch.PSObject.Properties['scope'] -or -not $Batch.PSObject.Properties['items']){throw 'Scoped claim response is required; the backend filter must be deployed first.'}
 $actual=@($Batch.scope.requestIds|ForEach-Object{([string]$_).ToLowerInvariant()}|Sort-Object -Unique)
 if(($actual -join ',') -cne (($Requests|Sort-Object -Unique) -join ',')){throw 'Claim response scope changed.'}
 $left=$Batch.scope.queuedRemaining
 if(($left -isnot [int] -and $left -isnot [long]) -or $left -lt 0 -or $left -gt $Before){throw 'Selected queued count increased or is invalid.'}
 $items=@($Batch.items)
 if($items.Count -gt 4 -or ($Consumed+$items.Count) -gt $Limit -or $left -gt ($Before-$items.Count)){throw 'Finite selected queue bounds did not verify.'}
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
Assert-Private $AgentSourceDirectory
foreach($entry in $payloadHashes.GetEnumerator()){
 $path=Join-Path $AgentSourceDirectory $entry.Key;Assert-ExistingPrivateFile $path
 if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $entry.Value){throw 'Pinned reviewed diagnostics payload hash validation failed.'}
 if($entry.Key -in $signedPayloads){$signature=Get-AuthenticodeSignature -LiteralPath $path;if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $signer -or -not $signature.TimeStamperCertificate){throw 'Pinned reviewed diagnostics payload signature validation failed.'}}
}
Assert-Private $WorkerCredentialPath
Assert-Private (Split-Path -Parent ([IO.Path]::GetFullPath($WorkerCredentialPath)))
Assert-Private $ReceiptDirectory
if(-not $Execute){[pscustomobject]@{Status='ValidatedNotStarted';ApprovedRequestIds=$approvedRequests;MaximumTargets=$MaximumTargets;CredentialRegenerated=$false;MeasurementsRequested=$false;AgentVersion='1.2.1'};return}
$other=Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'"|Where-Object{$_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)-File\s+(?:"[^"]*|[^\s]*)(?:Start-ReviewedBulkController|Invoke-BulkDiagnosticsEnrollment|Resume-ScopedDiagnosticsEnrollment|Invoke-DiagnosticsEnrollment121)\.ps1'}
if($other){throw 'Another reviewed bulk controller process is active; no parallel resume.'}
$mutex=[Threading.Mutex]::new($false,'Global\SCCC.Diagnostics.BulkEnrollment.v1.2.1');$locked=$false
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
  $verified=Test-ScopedResumeBatch $batch $approvedRequests $remainingBefore $consumed $MaximumTargets $seenTargets
  $remainingBefore=$verified.QueuedRemaining;$consumed+=$verified.ClaimedCount;$batchCount++
  $externalOrigin=[string]$batch.policy.externalProbeOrigin
  if($externalOrigin){$external=[Uri]$externalOrigin;if(-not $external.IsAbsoluteUri -or $external.Scheme -ne 'https' -or -not $external.IsDefaultPort -or $external.HostNameType -ne 'Dns' -or $external.UserInfo -or $external.Query -or $external.Fragment -or $external.AbsolutePath -ne '/'){throw 'The reviewed server external-origin policy did not validate.'}}
  @($batch.items)|ForEach-Object -Parallel {
   Set-StrictMode -Version Latest
   $ErrorActionPreference='Stop'
    $item=$_;$session=$null;$credential=$null;$phase='directory';$reason='installation-failed';$status='failed';$evidence=$null;$policyEvidence=$null;$failure=$null;$credentialAttempted=$false;$remoteStage=$null;$holds=$using:deliveryHolds
   $apiOrigin=$using:FredOrigin;$authorization=$using:headers;$source=$using:AgentSourceDirectory;$expectedSigner=$using:signer;$expectedSubject=$using:signerSubject;$hashes=$using:payloadHashes;$signedFiles=$using:signedPayloads
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
     $machinePolicy=(Get-ExecutionPolicy -Scope MachinePolicy).ToString()
     $publisher=Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$ApprovedSigner)
     $policyReason=if($machinePolicy -eq 'Restricted'){'execution-policy-restricted'}elseif($machinePolicy -notin @('AllSigned','Undefined','RemoteSigned','Unrestricted','Bypass')){'execution-policy-review-required'}
     [pscustomobject]@{Existing=((Test-Path -LiteralPath 'C:\ProgramData\SCCC-Diagnostics\Agent\config.json') -or ($null -ne (Get-ScheduledTask -TaskName 'SCCC Building Diagnostics' -ErrorAction SilentlyContinue)));MachinePolicy=$machinePolicy;TrustedPublisherPresent=[bool]$publisher;SystemUserPolicy='Unknown; not inferred from the remoting user';PolicyReason=$policyReason;PolicyReady=(-not $policyReason)}
    } @($item.computerName,$expectedSigner)
    $policyEvidence=@{MachinePolicy=[string]$preflight.MachinePolicy;SystemUserPolicy=[string]$preflight.SystemUserPolicy;TrustedPublisherPresent=[bool]$preflight.TrustedPublisherPresent;TaskProcessPolicy='AllSigned'}
    if($preflight.Existing){$status='skipped';$reason='existing-configuration-preserved';throw 'Existing protected helper state is retained.'}
    if(-not $preflight.PolicyReady){$status='skipped';$reason=[string]$preflight.PolicyReason;$phase='execution-policy-hold';throw 'Existing machine policy requires review before credential issuance.'}
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
    $null=Remote {param($Stage) $libre=Join-Path $Stage 'LibreSpeed';if(-not(Test-Path -LiteralPath $libre)){New-Item -ItemType Directory -Path $libre -Force|Out-Null}} @($remoteStage)
    foreach($file in $hashes.Keys){Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $remoteStage $file) -ToSession $session}
    $null=Remote {
     param($Stage,$Signer,$Subject,$ExpectedHashes,$SignedFiles)
     foreach($file in $ExpectedHashes.Keys){$path=Join-Path $Stage $file;if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $ExpectedHashes[$file]){throw 'Remote pinned hash mismatch.'};if($file -in $SignedFiles){$sig=Get-AuthenticodeSignature -LiteralPath $path;if($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Thumbprint -ine $Signer -or $sig.SignerCertificate.Subject -cne $Subject -or -not $sig.TimeStamperCertificate){throw 'Remote pinned signature mismatch.'}}}
     $cert=New-Object Security.Cryptography.X509Certificates.X509Certificate2 (Join-Path $Stage 'SCCC-Diagnostics-Signer.cer')
     if($cert.Thumbprint -ine $Signer -or $cert.Subject -cne $Subject){throw 'Pinned publisher certificate identity mismatch.'}
     if(-not(Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$Signer))){$store=[Security.Cryptography.X509Certificates.X509Store]::new('TrustedPublisher','LocalMachine');try{$store.Open('ReadWrite');$store.Add($cert)}finally{$store.Close()}}
     $installed=Get-Item -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$Signer) -ErrorAction Stop
     if($installed.Subject -cne $Subject){throw 'Trusted publisher read-back mismatch.'}
    } @($remoteStage,$expectedSigner,$expectedSubject,$hashes,$signedFiles)
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
       foreach($file in @('Invoke-DiagnosticsAgent.ps1','Sccc.Diagnostics.psm1','ExternalProbe.dll')){$installed=Join-Path 'C:\ProgramData\SCCC-Diagnostics\Agent' $file;$signature=Get-AuthenticodeSignature -LiteralPath $installed;if((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ine $ExpectedHashes[$file] -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $Signer){throw 'Installed pinned payload read-back failed.'}}
       foreach($file in @('LibreSpeed\librespeed-cli.exe','LibreSpeed\LICENSE')){$installed=Join-Path 'C:\ProgramData\SCCC-Diagnostics\Agent' $file;if((Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash -ine $ExpectedHashes[$file]){throw 'Installed LibreSpeed payload read-back failed.'}}
      Start-Sleep -Seconds 3
      $task=Get-ScheduledTask -TaskName 'SCCC Building Diagnostics' -ErrorAction Stop
      $system=($task.Principal.UserId -in @('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM'))
       $expectedRunner='C:\ProgramData\SCCC-Diagnostics\Agent\Invoke-DiagnosticsAgent.ps1'
      $action=@($task.Actions)[0]
      if(-not $system -or $task.State -ne 'Running' -or $action.Execute -ine (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -or $action.Arguments -cne ('-NoProfile -NonInteractive -ExecutionPolicy AllSigned -File "'+$expectedRunner+'"')){throw 'Managed SYSTEM helper task did not verify running.'}
       [pscustomobject]@{taskRunning=$true;taskSystem=$true;helperVersion='1.2.1';signerThumbprint=$Signer;payloadSha256=(Get-FileHash -LiteralPath 'C:\ProgramData\SCCC-Diagnostics\Agent\ExternalProbe.dll' -Algorithm SHA256).Hash;libreSpeedSha256=(Get-FileHash -LiteralPath 'C:\ProgramData\SCCC-Diagnostics\Agent\LibreSpeed\librespeed-cli.exe' -Algorithm SHA256).Hash}
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
  [pscustomobject]@{Status='SelectedQueueDrained';ApprovedRequestIds=$approvedRequests;ClaimedTargets=$consumed;Batches=$batchCount;QueuedRemaining=0;MeasurementsRequested=$false;ForeignRequestsClaimed=$false;AgentVersion='1.2.1'}
}finally{$headers.Clear();$workerToken=$null;if($clear){[Array]::Clear($clear,0,$clear.Length)};if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}

# SIG # Begin signature block
# MII9agYJKoZIhvcNAQcCoII9WzCCPVcCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCAN2qU+p1q9Qrz3
# 4BjOSFjwssSmt3xJ9c9BK+hKkb8GmKCCIiwwggXMMIIDtKADAgECAhBUmNLR1FsZ
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
# 03u4aUoqlmZpxJTG9F9urJh4iIAGXKKy7aIwggbDMIIEq6ADAgECAhMzAAmKWEV1
# HGd/kYG2AAAACYpYMA0GCSqGSIb3DQEBDAUAMFoxCzAJBgNVBAYTAlVTMR4wHAYD
# VQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29mdCBJ
# RCBWZXJpZmllZCBDUyBBT0MgQ0EgMDQwHhcNMjYxMDI4MDc1NDIxWhcNMjYxMDMx
# MDc1NDIxWjCBhDELMAkGA1UEBhMCVVMxDzANBgNVBAgTBkthbnNhczEQMA4GA1UE
# BxMHTGliZXJhbDEoMCYGA1UEChMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29s
# bGVnZTEoMCYGA1UEAxMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29sbGVnZTCC
# AaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBAIZyFTXe+VH6xk2X9eu19FFs
# NKNfh8gB/ZHfQS2bnyDM3YoR/9lauaj114MW4U+16HW7qYsuG40ZsZ8kSE5GzBjD
# NXIgCc13RdXb5+HO2YFDV6kk4g+4YWNupW3J5SmLDUd3lOkkP4WK51CUERYySReB
# dZR3wptVDmjaTcbjBCqOWHxiM4+6UOUA8z2ftAaVmUoYA3bL3hAhHsVkSk9oeJ4o
# uClRl2IEQRPKGvSCDcAPE2wr7BFoqeuemOTBx4BNMOtlJh8a6ON5M4PzS3ywnVeK
# eINc3EVkFmtbknO0NMXz2PzIE29FN+0D7f/JTh87ZBg7hCcSNRHthSCODDnM69oj
# vjfpcf3iRnQbqD/LL6cCNZV5gMQodp3ZOaxuVkvsQNYiWmYfyGgBeGG0i910/yqT
# hGFg+5ADmWdSGoglFgEXcxGxXXuF4nkAA1CCWnWg4RcnbkOlGYWZeco6EYeUIQFZ
# vx7QScc09MmqD5atbt2J8fcqaRv0EfLEEb6cYjJVVwIDAQABo4IB1TCCAdEwDAYD
# VR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwPAYDVR0lBDUwMwYKKwYBBAGCN2EB
# AAYIKwYBBQUHAwMGGysGAQQBgjdhgpKQiVaC9aWRWIK4/vAosum1djAdBgNVHQ4E
# FgQUDTLq8GHrfyutHFvHyYydoJOsrPkwHwYDVR0jBBgwFoAUayVB3vtrfP0YgAot
# f492XapzPbgwZwYDVR0fBGAwXjBcoFqgWIZWaHR0cDovL3d3dy5taWNyb3NvZnQu
# Y29tL3BraW9wcy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENTJTIw
# QU9DJTIwQ0ElMjAwNC5jcmwwdAYIKwYBBQUHAQEEaDBmMGQGCCsGAQUFBzAChlho
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDUyUyMEFPQyUyMENBJTIwMDQuY3J0MFQGA1UdIARN
# MEswSQYEVR0gADBBMD8GCCsGAQUFBwIBFjNodHRwOi8vd3d3Lm1pY3Jvc29mdC5j
# b20vcGtpb3BzL0RvY3MvUmVwb3NpdG9yeS5odG0wDQYJKoZIhvcNAQEMBQADggIB
# ADuyVjeQmGjv9H6UWS4D8h7g7MZxgzQYtZbFSwbLZ1jy4wZlwRU0Fui+m2uF59lx
# mAGkQPa/kwLkmne751ahLY6quI0SJBoKHpVclxIKUHXXDKZSL0MyROLV3Uo7NcHx
# /LovMkNnOVfuYygt+QNiopfl6V08eqDUv/n80iKpY911wjRiBa6gvRc/eI64DSa2
# 1017YS/EkfJ3PhF28JJ5jShv6jRAcrAxDdCz24OWB5LuqItmFZMHdDwnGwYfwGH1
# fY5FW6sJsfoNn9FAvw1HlVuUFgjrL5rY9KU3nlE9Uwf6ZzSpaEY8w0B3cOTgdboD
# HJTIZryRDMhkYW0qMF5T7/GVPhzkWT1HBGA7Z9WHgmpODol7coW+RIWdeZ7OmUHQ
# X5u5NjxTH325n2A3vc+4Hl4VY+rkR8oJhjla0CKsQzo782krFiZkiPcWEBiYnU2+
# bkbCzQ1/ImaIWRp0SRmJQaPiydjSSW7LPfJQv6ANcyAcXdI3foEYxadfxWbsvFni
# jIQEi31Fj+VMwT1ssyYcht7pgvJ9JaQ8/W4xrKWA8erMMuZDXELsTY2yvXkBbuMU
# uqLkUllDyK/RhI2noPZ9RIrpFB2Vf/doEii9eKovQKfmB66Lb/z4u52TI1xBugv3
# HPQfvhcV1ntJ43xfgQsMAtzqsnhLS4iGFa/0210lyx2gMIIGwzCCBKugAwIBAgIT
# MwAJilhFdRxnf5GBtgAAAAmKWDANBgkqhkiG9w0BAQwFADBaMQswCQYDVQQGEwJV
# UzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSswKQYDVQQDEyJNaWNy
# b3NvZnQgSUQgVmVyaWZpZWQgQ1MgQU9DIENBIDA0MB4XDTI2MTAyODA3NTQyMVoX
# DTI2MTAzMTA3NTQyMVowgYQxCzAJBgNVBAYTAlVTMQ8wDQYDVQQIEwZLYW5zYXMx
# EDAOBgNVBAcTB0xpYmVyYWwxKDAmBgNVBAoTH1Nld2FyZCBDb3VudHkgQ29tbXVu
# aXR5IENvbGxlZ2UxKDAmBgNVBAMTH1Nld2FyZCBDb3VudHkgQ29tbXVuaXR5IENv
# bGxlZ2UwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQCGchU13vlR+sZN
# l/XrtfRRbDSjX4fIAf2R30Etm58gzN2KEf/ZWrmo9deDFuFPteh1u6mLLhuNGbGf
# JEhORswYwzVyIAnNd0XV2+fhztmBQ1epJOIPuGFjbqVtyeUpiw1Hd5TpJD+FiudQ
# lBEWMkkXgXWUd8KbVQ5o2k3G4wQqjlh8YjOPulDlAPM9n7QGlZlKGAN2y94QIR7F
# ZEpPaHieKLgpUZdiBEETyhr0gg3ADxNsK+wRaKnrnpjkwceATTDrZSYfGujjeTOD
# 80t8sJ1XiniDXNxFZBZrW5JztDTF89j8yBNvRTftA+3/yU4fO2QYO4QnEjUR7YUg
# jgw5zOvaI7436XH94kZ0G6g/yy+nAjWVeYDEKHad2TmsblZL7EDWIlpmH8hoAXhh
# tIvddP8qk4RhYPuQA5lnUhqIJRYBF3MRsV17heJ5AANQglp1oOEXJ25DpRmFmXnK
# OhGHlCEBWb8e0EnHNPTJqg+WrW7difH3Kmkb9BHyxBG+nGIyVVcCAwEAAaOCAdUw
# ggHRMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMDwGA1UdJQQ1MDMGCisG
# AQQBgjdhAQAGCCsGAQUFBwMDBhsrBgEEAYI3YYKSkIlWgvWlkViCuP7wKLLptXYw
# HQYDVR0OBBYEFA0y6vBh638rrRxbx8mMnaCTrKz5MB8GA1UdIwQYMBaAFGslQd77
# a3z9GIAKLX+Pdl2qcz24MGcGA1UdHwRgMF4wXKBaoFiGVmh0dHA6Ly93d3cubWlj
# cm9zb2Z0LmNvbS9wa2lvcHMvY3JsL01pY3Jvc29mdCUyMElEJTIwVmVyaWZpZWQl
# MjBDUyUyMEFPQyUyMENBJTIwMDQuY3JsMHQGCCsGAQUFBwEBBGgwZjBkBggrBgEF
# BQcwAoZYaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNy
# b3NvZnQlMjBJRCUyMFZlcmlmaWVkJTIwQ1MlMjBBT0MlMjBDQSUyMDA0LmNydDBU
# BgNVHSAETTBLMEkGBFUdIAAwQTA/BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNy
# b3NvZnQuY29tL3BraW9wcy9Eb2NzL1JlcG9zaXRvcnkuaHRtMA0GCSqGSIb3DQEB
# DAUAA4ICAQA7slY3kJho7/R+lFkuA/Ie4OzGcYM0GLWWxUsGy2dY8uMGZcEVNBbo
# vptrhefZcZgBpED2v5MC5Jp3u+dWoS2OqriNEiQaCh6VXJcSClB11wymUi9DMkTi
# 1d1KOzXB8fy6LzJDZzlX7mMoLfkDYqKX5eldPHqg1L/5/NIiqWPddcI0YgWuoL0X
# P3iOuA0mttdNe2EvxJHydz4RdvCSeY0ob+o0QHKwMQ3Qs9uDlgeS7qiLZhWTB3Q8
# JxsGH8Bh9X2ORVurCbH6DZ/RQL8NR5VblBYI6y+a2PSlN55RPVMH+mc0qWhGPMNA
# d3Dk4HW6AxyUyGa8kQzIZGFtKjBeU+/xlT4c5Fk9RwRgO2fVh4JqTg6Je3KFvkSF
# nXmezplB0F+buTY8Ux99uZ9gN73PuB5eFWPq5EfKCYY5WtAirEM6O/NpKxYmZIj3
# FhAYmJ1Nvm5Gws0NfyJmiFkadEkZiUGj4snY0kluyz3yUL+gDXMgHF3SN36BGMWn
# X8Vm7LxZ4oyEBIt9RY/lTME9bLMmHIbe6YLyfSWkPP1uMaylgPHqzDLmQ1xC7E2N
# sr15AW7jFLqi5FJZQ8iv0YSNp6D2fUSK6RQdlX/3aBIovXiqL0Cn5geui2/8+Lud
# kyNcQboL9xz0H74XFdZ7SeN8X4ELDALc6rJ4S0uIhhWv9NtdJcsdoDCCBygwggUQ
# oAMCAQICEzMAAAAWMZKNkgJle5oAAAAAABYwDQYJKoZIhvcNAQEMBQAwYzELMAkG
# A1UEBhMCVVMxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjE0MDIGA1UE
# AxMrTWljcm9zb2Z0IElEIFZlcmlmaWVkIENvZGUgU2lnbmluZyBQQ0EgMjAyMTAe
# Fw0yNjAzMjYxODExMjlaFw0zMTAzMjYxODExMjlaMFoxCzAJBgNVBAYTAlVTMR4w
# HAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29m
# dCBJRCBWZXJpZmllZCBDUyBBT0MgQ0EgMDQwggIiMA0GCSqGSIb3DQEBAQUAA4IC
# DwAwggIKAoICAQDKVfrI2+gJMM/0bQ5OVKNdvOASzLbUUMvXuf+Vl7YGuofPaZHV
# o3gMHF5inT+GMSpIcfIZ9qtXU1UG68ry8vNbQtOL4Nm30ifXpqI1+ByiAWLO1YT0
# WnzG7XPOuoTeeWsNZv5FmjxCsReBZvyzyzCyXZbu1EQfJxWTH4ebUwtAiW9rqMf9
# eDj/wYhiEfNteJV3ZFeibD2ztCHr9JhFdd97XbnCHgQoTIqc02X5xlRKtUGBa++O
# tHBBjiJ/uwBnzTkqu4FjpZjQeJtrmda+ur1CT2jflWIB/ypn7u7V9tvW9wJbJYt/
# H2EtJ0GONWxJZ7TEu8jWPindOO3lzPP7UtzS/mVDV94HucWaltmsra6zSG8BoEJ8
# 7IM8QSb7vfm/O41FhYkUv89WIj5ES2O4kxyiMSfe95CMivCuYrRP2hKvx7egPMrW
# gDDBkxMLgrKZO9hRNUMm8vk3w5b9SogHOyJVhxyFm8aFXfIxgqDF4S0g4bhbhnzl
# jmSlCLlumMZcXFGDjpF2tNoAu3VGFGYtHtTSNVKvZpgB3b4ynaoDkbPf+Wg4523j
# t4VneasBgZhC1srZI2NCnCBBfgjLq04pqEKAWEohyW2K29KSkkHvt5VaE1ac3Yt+
# oyiOzMS57tXwQDJLGvLg/OXFO0VNvczDndfIfXYExB/ab2PuMSwd5VIBOwIDAQAB
# o4IB3DCCAdgwDgYDVR0PAQH/BAQDAgGGMBAGCSsGAQQBgjcVAQQDAgEAMB0GA1Ud
# DgQWBBRrJUHe+2t8/RiACi1/j3ZdqnM9uDBUBgNVHSAETTBLMEkGBFUdIAAwQTA/
# BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9Eb2Nz
# L1JlcG9zaXRvcnkuaHRtMBkGCSsGAQQBgjcUAgQMHgoAUwB1AGIAQwBBMBIGA1Ud
# EwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAU2UEpsA8PY2zvadf1zSmepEhqMOYw
# cAYDVR0fBGkwZzBloGOgYYZfaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9w
# cy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENvZGUlMjBTaWduaW5n
# JTIwUENBJTIwMjAyMS5jcmwwfQYIKwYBBQUHAQEEcTBvMG0GCCsGAQUFBzAChmFo
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDb2RlJTIwU2lnbmluZyUyMFBDQSUyMDIwMjEuY3J0
# MA0GCSqGSIb3DQEBDAUAA4ICAQAG1VBeVHTVRBljlcZD3IiMxwPyMjQyLNaEnVu5
# mODm2hRBJfH8GsBLATmrHAc8F47jmk5CnpUPiIguCbw6Z/KVj4Dsoiq228NSLMLe
# wFfGMri7uwNGLISC5ccp8vUdADDEIsS2dE+QI9OwkDpv3XuUD7d+hAgcLVcMOl1A
# sfEZtsZenhGvSYUrm/FuLq0BqEGL9GXM5c+Ho9q8o+Vn/S+GWQN2y+gkRO15s0kI
# 05nUpq/dOD4ri9rgVs6tipEd0YZqGgD+CZNiaZWrDTOQbNPncd2F9qOsUa20miYr
# uoT5PwJAaI+QQiTE2ZJeMJOkOpzhTUgqVMZwZidEUZKCqudaeQA08WwnkQMfKyHz
# aU8j48ULcU4hUwvMsv7fSurOe9GAdRQCPvF8WcSK5oDHe8VVJM4tv6KKCm91HqLx
# 9JamBgRI6R2SfY3nu26EGznu0rCg/769z8xWm4PVcC2ZaL6VlKVqFp1NsN8YqMyf
# 5t+bbGVb09noFKcJG/UwyGlxRmQBlfeBUQx5/ytlzZzsEnhrJF9fTAfje8j3OdX5
# lEnePTFQLRlvzZFBqUXnIeQKv3fHQjC9m2fo/Z01DII/qp3d8LhGVUW0BCG04fRw
# HJNH8iqqCG/qofMv+kym2AxBDnHzNgRjL60JOFiBgiurvLhYQNhB95KWojFA6shQ
# nggkMTCCB54wggWGoAMCAQICEzMAAAAHh6M0o3uljhwAAAAAAAcwDQYJKoZIhvcN
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
# b24xKzApBgNVBAMTIk1pY3Jvc29mdCBJRCBWZXJpZmllZCBDUyBBT0MgQ0EgMDQC
# EzMACYpYRXUcZ3+RgbYAAAAJilgwDQYJYIZIAWUDBAIBBQCgXjAQBgorBgEEAYI3
# AgEMMQIwADAZBgkqhkiG9w0BCQMxDAYKKwYBBAGCNwIBBDAvBgkqhkiG9w0BCQQx
# IgQg2+0NK80FzFbp/SlW5eXqpgTkO3jBCfE0FJ4ylSs6jlUwDQYJKoZIhvcNAQEB
# BQAEggGAWEg5NFaqxsnz90iPDIm4Lvo+arZQZcacNj0QwkGdcsYdbZFrGbjXsufv
# RDRawEBScWxWBu9yio+L//ba+Y+evK//v8kBrWINmdGiGxz09B3Esm09UOA3eKu/
# mncmSb+nTCQ/apuYFbx6vDl6CVe4gvrPp25tO1Bfm4pyRJTVQxJ7ZMB0xN+VHaSm
# ukSELWHku1f9FyJYX+/DUGRzSRsDx7EY3p9vd6t0BzBuxi3lY2e9AJ2YO3yXTcMJ
# cyVBpgXX8kQPX0RJID+hifRJW4ZuGmyWvw4o1n43GK4JMRLLtFUFI/KmSD4EEkUH
# iJbZebLW8RVeMO5bIbvy5F8WpJ1qX6NbAQe0P8iLHlu9iHbXi5BlKcpLmqaOs+oX
# 9scuqxUROlly2/Zazqp65BqNzTX0jTwNCwigrUYpYb+JIFHaSJ7enQkK4MlUAGJA
# IfSqZJp8Gb9lBNKaJOTJhydsuZE0wZWsZ2cSw7y7aZJpyIh0HRj3W31ItFWQq69p
# PugvsIhroYIYFDCCGBAGCisGAQQBgjcDAwExghgAMIIX/AYJKoZIhvcNAQcCoIIX
# 7TCCF+kCAQMxDzANBglghkgBZQMEAgEFADCCAWIGCyqGSIb3DQEJEAEEoIIBUQSC
# AU0wggFJAgEBBgorBgEEAYRZCgMBMDEwDQYJYIZIAWUDBAIBBQAEIGE6qivWCb0k
# D3I3UfFG0D/z2D4/VqsaPd0n6z0YCi68AgZq4KifvEAYEzIwMjYxMDMwMDAzNjU1
# Ljc3MVowBIACAfSggeGkgd4wgdsxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNo
# aW5ndG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29y
# cG9yYXRpb24xJTAjBgNVBAsTHE1pY3Jvc29mdCBBbWVyaWNhIE9wZXJhdGlvbnMx
# JzAlBgNVBAsTHm5TaGllbGQgVFNTIEVTTjpBNTAwLTA1RTAtRDk0NzE1MDMGA1UE
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
# 2GwYe6ZoAF1bMIIHlzCCBX+gAwIBAgITMwAAAGByBiSKSgW42QAAAAAAYDANBgkq
# hkiG9w0BAQwFADBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENv
# cnBvcmF0aW9uMTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3Rh
# bXBpbmcgQ0EgMjAyMDAeFw0yNjA5MTcxODU3MjdaFw0yNzA5MTQxODU3MjdaMIHb
# MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVk
# bW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSUwIwYDVQQLExxN
# aWNyb3NvZnQgQW1lcmljYSBPcGVyYXRpb25zMScwJQYDVQQLEx5uU2hpZWxkIFRT
# UyBFU046QTUwMC0wNUUwLUQ5NDcxNTAzBgNVBAMTLE1pY3Jvc29mdCBQdWJsaWMg
# UlNBIFRpbWUgU3RhbXBpbmcgQXV0aG9yaXR5MIICIjANBgkqhkiG9w0BAQEFAAOC
# Ag8AMIICCgKCAgEAmhNjS8BTx4r6Q3zHgEqciUf2JBMVwiIRCV82vlxzmNYRpAOm
# qNmne9T8FJFgZ6e9Oz6gezhRB+F8F49Si6nB++sT+uSdFsxXTlF8rnzmBBefi/Z4
# ohZK2txCV0nNcMw7hICTvEEqNgK4ZlpchXVr8chY+xULKyRUarNXGI7yabgviPWp
# mYB+W/GoHlnfV6Ld5anYNyH4USOTSVVQA/1IpX+9G4O70udmve0nNXTMHaZqtctu
# T7+iLalp6AD2UWkg0U/ozvL1ZVPGY3XIqpoP4RIOU2SJ+Q9v8IA3eZeINtAInBK8
# 8C+7AFvfydqru6PvgOyZwm778JAmrfBCA+FjOY4fyfaig1lJc11/9sR+L67BbLXr
# jxmbm6MNgxjJ96L9LjyVVKRW45MbEwoWfYpxkSZ7N5Vz908/a4togyXYqhpjcmzU
# dwYQfXvKSXZMEF5xUGKefzfhWcfOOREb6nfUKMTXNIIKEQPUVrSp04wKf9qQO1sk
# 6KtoEP14ZE1hI2B8kLAppG//CWKDzKMUCTUNyz8TGeS/MwZ8sT5at4n8GYTj31LT
# va49YNTihJALBSZicyRn7i8E3NQG5LhlU6RTnKNGCVnMdIK/UFXxTlWYQQF3sN3F
# zRpSXm5k1DPajiOQqK9/GDEFFnOCoo7okLChqn6VHpLkuItQQPBuPbHI4t8CAwEA
# AaOCAcswggHHMB0GA1UdDgQWBBSIVCh0YVAEOxMJuILekqO3XtpqYjAfBgNVHSME
# GDAWgBRraSg6NS9IY0DPe9ivSek+2T3bITBsBgNVHR8EZTBjMGGgX6BdhltodHRw
# Oi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NybC9NaWNyb3NvZnQlMjBQdWJs
# aWMlMjBSU0ElMjBUaW1lc3RhbXBpbmclMjBDQSUyMDIwMjAuY3JsMHkGCCsGAQUF
# BwEBBG0wazBpBggrBgEFBQcwAoZdaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3Br
# aW9wcy9jZXJ0cy9NaWNyb3NvZnQlMjBQdWJsaWMlMjBSU0ElMjBUaW1lc3RhbXBp
# bmclMjBDQSUyMDIwMjAuY3J0MAwGA1UdEwEB/wQCMAAwFgYDVR0lAQH/BAwwCgYI
# KwYBBQUHAwgwDgYDVR0PAQH/BAQDAgeAMGYGA1UdIARfMF0wUQYMKwYBBAGCN0yD
# fQEBMEEwPwYIKwYBBQUHAgEWM2h0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2lv
# cHMvRG9jcy9SZXBvc2l0b3J5Lmh0bTAIBgZngQwBBAIwDQYJKoZIhvcNAQEMBQAD
# ggIBAFeL5n8pBTSXPRm05dicbm+CuaLpcAM/kCh7yxKbo7LY1xYhw5yIa/elOWLj
# phVWufGgnnEXBqq42uGDPOAzFRFHuBlw8h27CxluosTMcxs8Ers9rgQb7NgnHHNu
# fczmr7lzn7dkITnLwYo4l12xbkkj2VwC1L0eYtbhJEjsqbgXnaOH1ArOPb/rxqXt
# narEuDvZiBMwbNl7LkQXlTmDSjh8AnF5V8OCmvAeSz7DMG3zDtxmFbfzV0BseJWT
# z1ZiJzTXvOCVGh0sCC0m+xVBxpn+fE8kstkKIVO8D4MZrAt9roQFYH/AKo3dnTjr
# q88UuA76qpRaZhr0+zf2iF0gKAHBgGYPNnPZ73IHQRJMQifSCq/MoWQa38O3sfac
# DR2vgxvDZ+jfo7LQFXg+CCgH2hz6HZfhfD8SnTe9mAYHY/RMaHhR9+jJ0qlbvFjH
# aEBF3isAqWopsTJWVDMPEy47hwOIfkAyL9c4/ccIlzS0nFHRKxhN54OX1N/bNwZx
# wbSHLoX7Y+VSdWEfp/wrnbUofI5Kyhage4gZOMZXt33cxxVFGBrTkqpNuxNrAYWv
# 9thMfdSEQvGVelAgLyedMjQkV/e8UD/la7N58dWdzcNlXFbfNRe/Fhzsf4SrW1Il
# lyFuXI2GsZyXY1KHhCnAGk8p4td4JIuDIVtq6RoBXhAl0gAWMYIHRjCCB0ICAQEw
# eDBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
# MTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0Eg
# MjAyMAITMwAAAGByBiSKSgW42QAAAAAAYDANBglghkgBZQMEAgEFAKCCBJ8wEQYL
# KoZIhvcNAQkQAg8xAgUAMBoGCSqGSIb3DQEJAzENBgsqhkiG9w0BCRABBDAcBgkq
# hkiG9w0BCQUxDxcNMjYxMDMwMDAzNjU1WjAvBgkqhkiG9w0BCQQxIgQgttkv+OOA
# VkjmCh49NlVZrP6I60GuKanlRgWGtfZCEcIwgbkGCyqGSIb3DQEJEAIvMYGpMIGm
# MIGjMIGgBCA3y4y58L0ueLrSqjysZnGJR+zq52tMXNNfTKV6UrYCszB8MGWkYzBh
# MQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMTIw
# MAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0EgMjAy
# MAITMwAAAGByBiSKSgW42QAAAAAAYDCCA2EGCyqGSIb3DQEJEAISMYIDUDCCA0yh
# ggNIMIIDRDCCAiwCAQEwggEJoYHhpIHeMIHbMQswCQYDVQQGEwJVUzETMBEGA1UE
# CBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9z
# b2Z0IENvcnBvcmF0aW9uMSUwIwYDVQQLExxNaWNyb3NvZnQgQW1lcmljYSBPcGVy
# YXRpb25zMScwJQYDVQQLEx5uU2hpZWxkIFRTUyBFU046QTUwMC0wNUUwLUQ5NDcx
# NTAzBgNVBAMTLE1pY3Jvc29mdCBQdWJsaWMgUlNBIFRpbWUgU3RhbXBpbmcgQXV0
# aG9yaXR5oiMKAQEwBwYFKw4DAhoDFQCXvzPIwr1JZPPiLWOtCVFio3VCN6BnMGWk
# YzBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
# MTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0Eg
# MjAyMDANBgkqhkiG9w0BAQsFAAIFAO6NyhwwIhgPMjAyNjEwMjkxMzM1MjRaGA8y
# MDI2MTAzMDEzMzUyNFowdzA9BgorBgEEAYRZCgQBMS8wLTAKAgUA7o3KHAIBADAK
# AgEAAgIwRAIB/zAHAgEAAgIRkzAKAgUA7o8bnAIBADA2BgorBgEEAYRZCgQCMSgw
# JjAMBgorBgEEAYRZCgMCoAowCAIBAAIDB6EgoQowCAIBAAIDAYagMA0GCSqGSIb3
# DQEBCwUAA4IBAQB2m2Zl/DWvay1ge07M7/6ySMcGdVznCBsyw2OPxxkHxyB7vgj4
# +2qkHjU/5WGXs//wMKFTpsm5kRFKBr3L1w/x/60lxW9ggqSoHBzbfI6yYT1rrwyR
# EgvdXcIcaAz+kEcv7fsLuelYb7ET0XdeBSV1VEV4LmyuV0Hxai0AIDmp5VVTbomV
# 0C9PWQtU0dZfNLhzNydL3E/eNoDL4pfz5H81Z6YT2vjztnenOM1hJzB7NuB/b8MK
# c6dkhKayd1Bs/3YJ2TZJFV+TwBmHBFnzZRX21fjzMEqK2mE2PRRFjvrtNgRXP711
# LbW7fgCtePe57Fi6Ql9+kj9K/idFGFaX+PmjMA0GCSqGSIb3DQEBAQUABIICACLP
# x575HSv3N6bWiiAxO91dzMALpurIE+29WOX3KMiaqCy5743dX7GPltd/F+5mPZH0
# 0NjJRRQrZUliB8jllp+DcehMN20tj58+/Ptwvhm4/EuWj2RNEXJYJA5AlepecinG
# Z+SuApoCshZogJnb7wdbbc9OlDqKNgpCVGfsQ8h0Sreh58xb/VP22oCkVkJwjXiT
# 9x8DzMT6LbSy32q79N4DrqT4R+PoU5rGUP6Lw3uAsb9+cg6E0wfwc2uvCWxe/k82
# SpP5gd69wCnR5zgukQmTfD6bNRarGoTmNzqD+LQW371GjSCPlsb01Z1EDeWyAfYs
# A6KGgXfYkk2UNx17ZFStFfF2JkRqDWXjKZAgaz/Fq3GLToENesgWKQ8ICGadz4sU
# /Qh2EotNh7ZL2cXwmLmCljTBRBzZ5yt2FuDYHjqm5gPk9XeRcg2xoF5ahdOU/J+2
# AFvw5qfDeO69snZ7RgOpPUwTiPUeZtVwRHmUOBS15Ia36Lnn4OJWbTvzS/SFetrK
# N11AuI0rMrD+Ap/DGYqz4Lu0DvO1g8fEr6SDJQ7Z1B886mjV9xu1/ixs5pP24s9B
# b/vsqcKC+JOo8qFvaiZVPepqJSzY04TnaGTpa97fRg6u9/4XzzjJo2X65/nnG77V
# EDHt2ixoTmrPrGS+G8I1i3j2WT3djO0fuGX70fGV
# SIG # End signature block
