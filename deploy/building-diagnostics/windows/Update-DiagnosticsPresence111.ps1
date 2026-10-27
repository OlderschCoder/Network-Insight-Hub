#requires -Version 5.1
[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidateSet('SUR-AK','SUR-AT','SUR-KK','SUR-LC')][string]$ExpectedComputer,
 [Parameter(Mandatory)][Guid]$RunId,
 [ValidateSet('Apply','Rollback')][string]$Mode='Apply',
 [byte[]]$NewModuleBytes
)
# Invoke only through an existing, authenticated Kerberos administrator PSSession.
# Configuration is inspected by metadata/ACL only; no config/DPAPI/MFA content is read or written.
$ErrorActionPreference='Stop';$phase='preflight';$replaced=$false;$stopped=$false
$oldHash='0BE3E9B21B4263AD59251277C3427043E22AB8E3DAAFF47D120410DE1FFF76F8'
$newHash='60DB79572D91C0448342D6D5122FB71D2475DCEE966E69978CF9CEBA8FFA8A83'
$oldSigner='9C6F10572711B7BD83AED649B405E239A9F345B0';$newSigner='A9EA8B0DC141AEC21544359FF3DFD4E9499EA177'
$newTimestamp='97BF33C8C2BD4964F3E22D63AD095162A3754237'
$root='C:\ProgramData\SCCC\Diagnostics';$module=Join-Path $root 'Sccc.Diagnostics.psm1';$config=Join-Path $root 'config.json'
$taskName='SCCC Building Diagnostics';$stageRoot='C:\ProgramData\SCCC-Diagnostics';$stage=Join-Path $stageRoot ('Presence111-'+$RunId.ToString('N'))
$candidate=Join-Path $stage 'candidate.psm1';$backup=Join-Path $stage 'original.psm1';$receipt=Join-Path $stage 'before.json'
function Hash([string]$Path){(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash}
function NoLink([string]$Path){$p=$Path;while($p){if((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirected path rejected.'};$next=Split-Path -Parent $p;if($next -eq $p){break};$p=$next}}
function SafeAcl([string]$Path,[bool]$Private=$true){
 NoLink $Path;$a=Get-Acl -LiteralPath $Path
 if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18','S-1-5-32-544') -or ($Private -and -not $a.AreAccessRulesProtected)){throw 'Protected ownership/inheritance mismatch.'}
 foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544') -and ($Private -or ([int]$r.FileSystemRights -band 0xD0156))){throw 'Untrusted filesystem access rejected.'}}
 $a
}
function FileMeta([string]$Path){$a=SafeAcl $Path;$f=Get-Item -LiteralPath $Path -Force;if($f.PSIsContainer){throw 'Expected existing regular file.'};[ordered]@{Length=$f.Length;CreatedUtcTicks=$f.CreationTimeUtc.Ticks;WrittenUtcTicks=$f.LastWriteTimeUtc.Ticks;Sddl=$a.Sddl}}
function Same($A,$B){($A|ConvertTo-Json -Depth 5 -Compress) -ceq ($B|ConvertTo-Json -Depth 5 -Compress)}
function Signed([string]$Path,[string]$Digest,[string]$Signer,[string]$Timestamp=''){
 $null=SafeAcl $Path;$s=Get-AuthenticodeSignature -LiteralPath $Path
 if((Hash $Path) -cne $Digest -or $s.Status -ne 'Valid' -or -not $s.TimeStamperCertificate -or $s.SignerCertificate.Thumbprint -ine $Signer -or ($Timestamp -and $s.TimeStamperCertificate.Thumbprint -ine $Timestamp)){throw 'Pinned signed payload mismatch.'}
}
function PrivateDirectory([string]$Path){
 if(Test-Path -LiteralPath $Path){throw 'Fresh private staging directory required.'}
 $a=[Security.AccessControl.DirectorySecurity]::new();$a.SetSecurityDescriptorSddlForm('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
 if('System.IO.FileSystemAclExtensions' -as [type]){[void][IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path),$a)}else{[void][IO.Directory]::CreateDirectory($Path,$a)};$null=SafeAcl $Path
}
function TaskFacts{
 $t=Get-ScheduledTask -TaskName $taskName -TaskPath '\';$a=@($t.Actions)
 $args='-NoProfile -NonInteractive -ExecutionPolicy AllSigned -File "C:\ProgramData\SCCC\Diagnostics\Invoke-DiagnosticsAgent.ps1"'
 if(-not $t.Settings.Enabled -or $t.Principal.UserId -notin @('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM') -or $t.Principal.LogonType -ne 'ServiceAccount' -or $t.Principal.RunLevel -ne 'Highest' -or $a.Count -ne 1 -or $a[0].Execute -ine "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -or $a[0].Arguments -cne $args -or $a[0].WorkingDirectory){throw 'Existing SYSTEM task action/policy mismatch.'}
 $sha=[Security.Cryptography.SHA256]::Create();try{$digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes((Export-ScheduledTask -TaskName $taskName -TaskPath '\'))))).Replace('-','')}finally{$sha.Dispose()}
 [ordered]@{XmlSha256=$digest;State=[string]$t.State}
}
function WaitStopped{
 $until=[DateTime]::UtcNow.AddSeconds(20)
 do{if((Get-ScheduledTask -TaskName $taskName -TaskPath '\').State -eq 'Ready'){return};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $until)
 throw 'Existing diagnostics task did not stop within20seconds; hold without replacement.'
}
try{
 if($RunId -eq [Guid]::Empty -or $env:COMPUTERNAME -ine $ExpectedComputer -or -not $PSSenderInfo -or $PSSenderInfo.UserInfo.Identity.AuthenticationType -ne 'Kerberos'){throw 'Pinned host and normal Kerberos remoting required.'}
 if(-not ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Existing administrator authority required.'}
 $system=Get-CimInstance Win32_ComputerSystem;$os=Get-CimInstance Win32_OperatingSystem
 if(-not $system.PartOfDomain -or $system.Domain -ine 'sccc.edu' -or $system.DomainRole -ne 1 -or $os.ProductType -ne 1){throw 'Expected SCCC domain workstation required.'}
 $null=SafeAcl (Split-Path -Parent $root) $false;$null=SafeAcl $root;$null=SafeAcl $stageRoot
 $invoke=Join-Path $root 'Invoke-DiagnosticsAgent.ps1';$dll=Join-Path $root 'ExternalProbe.dll'
 Signed $invoke '25AA875D167CEF8898C7CC018A48058CE7BA3E6C9325913AD20837FFE794BDDF' $oldSigner
 Signed $dll 'B79FEB87B4F2EEE951308C34D2397516C5602F6A2A103E3BDB1C38767A4FDC85' $oldSigner
 $configBefore=FileMeta $config;$moduleAcl=SafeAcl $module;$taskBefore=TaskFacts
 $policy=[string](Get-ExecutionPolicy -Scope MachinePolicy);$newPublisher=Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$newSigner);$oldPublisher=Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPublisher\'+$oldSigner)
 $publishersReady=if($Mode -eq 'Apply'){$oldPublisher -and $newPublisher}else{$oldPublisher}
 if($policy -eq 'Restricted' -or ($policy -in @('AllSigned','Undefined') -and -not $publishersReady) -or $policy -notin @('AllSigned','Undefined','RemoteSigned','Unrestricted')){throw 'Existing execution policy/publisher trust requires review; no policy or certificate changes permitted.'}
 if($Mode -eq 'Apply'){
  Signed $module $oldHash $oldSigner
  if(-not $NewModuleBytes -or $NewModuleBytes.Length -gt 1048576){throw 'Bounded signed module bytes required.'}
  PrivateDirectory $stage
  [IO.File]::WriteAllBytes($candidate,$NewModuleBytes);Set-Acl -LiteralPath $candidate -AclObject $moduleAcl;Signed $candidate $newHash $newSigner $newTimestamp
  Copy-Item -LiteralPath $module -Destination $backup;Set-Acl -LiteralPath $backup -AclObject $moduleAcl;Signed $backup $oldHash $oldSigner
  [ordered]@{Schema='sccc.diagnostics.presence111.before.v1';Computer=$ExpectedComputer;RunId=$RunId.ToString();Config=$configBefore;ModuleSddl=$moduleAcl.Sddl;TaskXmlSha256=$taskBefore.XmlSha256}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $receipt -Encoding utf8
  Set-Acl -LiteralPath $receipt -AclObject $moduleAcl;$null=SafeAcl $receipt
 }else{
  if($NewModuleBytes){throw 'Rollback does not accept replacement bytes.'};$null=SafeAcl $stage;$null=SafeAcl $receipt
  $before=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
  if($before.Schema -cne 'sccc.diagnostics.presence111.before.v1' -or $before.Computer -ine $ExpectedComputer -or $before.RunId -ine $RunId.ToString() -or -not (Same $before.Config $configBefore) -or $before.ModuleSddl -cne $moduleAcl.Sddl -or $before.TaskXmlSha256 -cne $taskBefore.XmlSha256){throw 'Explicit rollback baseline drift; hold without changing files.'}
  Signed $module $newHash $newSigner $newTimestamp;Signed $backup $oldHash $oldSigner
  if(Test-Path -LiteralPath $candidate){throw 'Unexpected rollback staging file; preserve evidence.'}
  Copy-Item -LiteralPath $backup -Destination $candidate;Set-Acl -LiteralPath $candidate -AclObject $moduleAcl;Signed $candidate $oldHash $oldSigner
 }
 $phase='stop-existing-diagnostics-task';Stop-ScheduledTask -TaskName $taskName -TaskPath '\';$stopped=$true;WaitStopped
 if(-not (Same $configBefore (FileMeta $config)) -or (TaskFacts).XmlSha256 -cne $taskBefore.XmlSha256){throw 'Configuration/task changed before replacement; hold.'}
 $expectedCurrent=if($Mode -eq 'Apply'){$oldHash}else{$newHash};if((Hash $module) -cne $expectedCurrent -or (Get-Acl -LiteralPath $module).Sddl -cne $moduleAcl.Sddl){throw 'Module drift before replacement; hold.'}
 $phase='atomic-one-module-replacement';[IO.File]::Replace($candidate,$module,[System.Management.Automation.Language.NullString]::Value);$replaced=$true
 if($Mode -eq 'Apply'){Signed $module $newHash $newSigner $newTimestamp}else{Signed $module $oldHash $oldSigner}
 if((Get-Acl -LiteralPath $module).Sddl -cne $moduleAcl.Sddl -or -not (Same $configBefore (FileMeta $config)) -or (TaskFacts).XmlSha256 -cne $taskBefore.XmlSha256){throw 'Post-replacement metadata drift; hold without automatic rollback.'}
 $phase='start-existing-diagnostics-task-once';Start-ScheduledTask -TaskName $taskName -TaskPath '\';$stopped=$false
 $until=[DateTime]::UtcNow.AddSeconds(10);do{$state=(Get-ScheduledTask -TaskName $taskName -TaskPath '\').State;if($state -eq 'Running'){break};Start-Sleep -Milliseconds 250}while([DateTime]::UtcNow -lt $until)
 if($state -ne 'Running' -or -not (Same $configBefore (FileMeta $config)) -or (TaskFacts).XmlSha256 -cne $taskBefore.XmlSha256){throw 'Task start or post-start metadata did not verify; hold without cycling.'}
 [pscustomobject]@{Computer=$ExpectedComputer;RunId=$RunId.ToString();Mode=$Mode;Status='ModuleVerifiedTaskRunningAwaitingBackendProof';ModuleSha256=(Hash $module);ConfigMetadataUnchanged=$true;TaskDefinitionUnchanged=$true;ProtectedEvidence=$stage;AutomaticRollback=$false;CredentialsOrMfaReadOrWritten=$false}
}catch{
 [pscustomobject]@{Computer=$ExpectedComputer;RunId=$RunId.ToString();Mode=$Mode;Status='ReviewRequired';Phase=$phase;ModuleReplaced=$replaced;TaskStopped=$stopped;ErrorType=$_.Exception.GetType().FullName;AutomaticRollback=$false;CredentialsOrMfaReadOrWritten=$false}
 throw 'Focused module update held for review; no automatic rollback or further task cycling.'
}
