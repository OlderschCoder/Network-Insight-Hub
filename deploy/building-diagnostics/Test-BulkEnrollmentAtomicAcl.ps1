#Requires -Version 5.1
# Synthetic local filesystem test only. No credentials, remoting, tasks, AD or installation.
$ErrorActionPreference='Stop'
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('diagnostics-atomic-acl-'+[Guid]::NewGuid().ToString('N'))
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$directoryAcl=[Security.AccessControl.DirectorySecurity]::new()
$directoryAcl.SetAccessRuleProtection($true,$false);$directoryAcl.SetOwner($owner)
$directoryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
$leaf=Join-Path $fixture 'nested\leaf'
[void][IO.Directory]::CreateDirectory($leaf,$directoryAcl)
foreach($directory in @($fixture,(Join-Path $fixture 'nested'),$leaf)){
 $acl=Get-Acl -LiteralPath $directory
 if(-not $acl.AreAccessRulesProtected -or @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object{$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ne $owner.Value}).Count){throw 'Atomic directory creation did not apply the private DACL to every new component.'}
}
$path=Join-Path $leaf 'synthetic.json'
$fileAcl=[Security.AccessControl.FileSecurity]::new();$fileAcl.SetAccessRuleProtection($true,$false);$fileAcl.SetOwner($owner)
$fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','Allow'))
$stream=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$fileAcl)
try{
 $acl=Get-Acl -LiteralPath $path
 if(-not $acl.AreAccessRulesProtected){throw 'Private file DACL was not present before writing.'}
 $bytes=[Text.Encoding]::UTF8.GetBytes('{"synthetic":true}')
 $stream.Write($bytes,0,$bytes.Length)
}finally{$stream.Dispose()}
$rejected=$false
try{$duplicate=[IO.FileStream]::new($path,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$fileAcl);$duplicate.Dispose()}catch [IO.IOException]{$rejected=$true}
if(-not $rejected){throw 'Exclusive CreateNew did not reject an existing input file.'}
[pscustomobject]@{AtomicDirectoryAcl=$true;PrivateAclBeforeWrite=$true;ExistingInputRejected=$true;SyntheticFixture=$fixture;EndpointChanges=$false}
