#Requires -Version 7.2
# Local tests only: extract four public signed payloads and simulate only PrivateDirectory.
# Never invokes setup, elevation, remoting, DPAPI, tasks, controller, or enrollment APIs.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$setup=Join-Path $PSScriptRoot 'Start-ReviewedBulkController.ps1'
if((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -cne '636A99D06E4BE60E1EF25C2AB77A012F3BF25A0583DFE8DCEAFB094B77076EE1'){throw 'Reviewed setup source changed; review the test pin first.'}
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($setup,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'Setup does not parse.'}
$assignments=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst]},$true))
$zip=($assignments|Where-Object {$_.Left.Extent.Text -ceq '$zip'}|Select-Object -First 1).Right.Expression.SafeGetValue()
$pinned=($assignments|Where-Object {$_.Left.Extent.Text -ceq '$pinned'}|Select-Object -First 1).Right.Expression.SafeGetValue()
if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -cne 'DE2626613DBF1B90898FF38DAD8999A6DB5D9C582E117F0886B774AB832788A3'){throw 'Pinned public payload archive changed.'}
$getEntry=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Value -ceq 'GetEntry'},$true))
if($getEntry.Count -ne 1 -or $getEntry[0].Arguments[0] -isnot [Management.Automation.Language.BinaryExpressionAst]){throw 'Review changed archive member lookup.'}
$prefix=$getEntry[0].Arguments[0].Left.SafeGetValue()
if($prefix -cne '1.1.0-rc1\' -or $pinned.Count -ne 4){throw 'Expected the actual literal backslash archive prefix and four payload pins.'}
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('sccc-setup-public-test-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$archive=[IO.Compression.ZipFile]::OpenRead($zip)
$verified=0
try{
 foreach($name in $pinned.Keys){
  if($name -notin @('Install-DiagnosticsAgent.ps1','Invoke-DiagnosticsAgent.ps1','Sccc.Diagnostics.psm1','ExternalProbe.dll')){throw 'Unexpected pinned payload name.'}
  $fullName=$prefix+$name
  $matches=@($archive.Entries|Where-Object {$_.FullName -ceq $fullName})
  if($matches.Count -ne 1){throw ('Exact archive member absent or duplicated: '+$fullName)}
  $target=Join-Path $fixture $name
  [IO.Compression.ZipFileExtensions]::ExtractToFile($matches[0],$target,$false)
  $signature=Get-AuthenticodeSignature -LiteralPath $target
  if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -cne $pinned[$name] -or $signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine '9C6F10572711B7BD83AED649B405E239A9F345B0' -or -not $signature.TimeStamperCertificate){throw ('Public payload hash/signature failed: '+$name)}
  $verified++
 }
}finally{
 $archive.Dispose()
 # Delete only the known public files created by this test; never recursively remove a computed path.
 foreach($name in $pinned.Keys){$target=Join-Path $fixture $name;if(Test-Path -LiteralPath $target -PathType Leaf){Remove-Item -LiteralPath $target -Force}}
 Remove-Item -LiteralPath $fixture -Force
}
$functions=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'PrivateDirectory'},$true))
if($functions.Count -ne 1){throw 'Expected one reviewed PrivateDirectory function.'}
$definition=$functions[0].Extent.Text
$create='[void][IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Path),$acl)'
if($definition.Split(@($create),[StringSplitOptions]::None).Count -ne 2){throw 'Review changed atomic directory creation before instrumenting the test.'}
# Instrument only the native filesystem write. All control flow and ACL checks remain the extracted function.
$simulation=$definition.Replace($create,'SyntheticCreate $Path')
$cases=& {
 param($Definition)
 $state=@{Created=$false;Creates=0;Reads=0;Acl=$null;Reparse=$false}
 function Test-Path {param([string]$LiteralPath) return $state.Created}
 function Get-Item {param([string]$LiteralPath,[switch]$Force) [pscustomobject]@{Attributes=$(if($state.Reparse){[IO.FileAttributes]::ReparsePoint}else{[IO.FileAttributes]::Directory})}}
 function Get-Acl {param([string]$LiteralPath) $state.Reads++;return $state.Acl}
 function SyntheticCreate {param([string]$Path) $state.Creates++;$state.Created=$true}
 . ([scriptblock]::Create($Definition))
 foreach($scenario in @('private','foreign-access','inherited','foreign-owner','reparse')){
  $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($scenario -ne 'inherited',$false)
  $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($(if($scenario -eq 'foreign-owner'){'S-1-5-32-545'}else{'S-1-5-18'})))
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
  if($scenario -eq 'foreign-access'){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'ReadAndExecute','Allow'))}
  $state.Created=$false;$state.Creates=0;$state.Reads=0;$state.Acl=$acl;$state.Reparse=$scenario -eq 'reparse';$rejected=$false
  try{PrivateDirectory 'C:\SYNTHETIC-NO-FILESYSTEM-WRITES'}catch{$rejected=$true}
  if($state.Creates -ne 1 -or ($scenario -eq 'private' -and ($rejected -or $state.Reads -ne 1)) -or ($scenario -ne 'private' -and -not $rejected)){throw ('Post-create private ACL regression: '+$scenario)}
  [pscustomobject]@{Scenario=$scenario;ExpectedOutcomeVerified=$true}
 }
} $simulation
[pscustomobject]@{PinnedArchiveMembersVerified=$verified;PostCreateAclCasesVerified=@($cases).Count;NoRemoteCalls=$true;SetupOrControllerExecuted=$false}|ConvertTo-Json
