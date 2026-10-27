#Requires -Version 7.2
# Synthetic native runspaces only: no DNS, remoting, HTTP, credential or task operations.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-BulkDiagnosticsEnrollment.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Controller parse failed'}
$parallel=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'ForEach-Object' -and @($n.CommandElements|Where-Object{$_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -eq 'Parallel'}).Count},$true))
if($parallel.Count -ne 1){throw 'Expected one bounded controller parallel block'}
$block=@($parallel[0].CommandElements|Where-Object{$_ -is [Management.Automation.Language.ScriptBlockExpressionAst]})[0].ScriptBlock
$prologue=($block.EndBlock.Statements|Select-Object -First 2|ForEach-Object{$_.Extent.Text}) -join "`n"
if($prologue -notmatch 'Set-StrictMode' -or $prologue -notmatch "ErrorActionPreference='Stop'"){throw 'Child runspace error/strict settings must precede every worker operation'}
$classifier=@($block.FindAll({param($n) $n -is [Management.Automation.Language.IfStatementAst] -and $n.Extent.Text -match "reason -in @\('private-dns-unavailable','kerberos-unavailable'\)"},$true))
if($classifier.Count -ne 1){throw 'Expected actual controller unreachable classifier'}
$code=@'
{{PROLOGUE}}
$item=$_;$status='failed';$reason='private-dns-unavailable';$caught=$false
try{
 if($item -eq 'dns-failure'){Write-Error -Message 'Synthetic DNS-style nonterminating failure' -ErrorId 'SyntheticDnsUnavailable' -Category ObjectNotFound}
 $status='installed'
}catch{
 $caught=$true
 {{CLASSIFIER}}
}
[pscustomobject]@{Item=$item;Status=$status;Caught=$caught}
'@
$code=$code.Replace('{{PROLOGUE}}',$prologue).Replace('{{CLASSIFIER}}',$classifier[0].Extent.Text)
$worker=[scriptblock]::Create($code)
$first=@(@('dns-failure','later-healthy')|ForEach-Object -Parallel $worker -ThrottleLimit 1)
$next=@('next-watch-batch'|ForEach-Object -Parallel $worker -ThrottleLimit 1)
if(@($first|Where-Object{$_.Item -eq 'dns-failure' -and $_.Status -eq 'unreachable' -and $_.Caught}).Count -ne 1){throw 'DNS-style error did not remain local/unreachable'}
if(@($first|Where-Object{$_.Item -eq 'later-healthy' -and $_.Status -eq 'installed'}).Count -ne 1 -or $next[0].Status -ne 'installed'){throw 'Later healthy worker or Watch continuation was interrupted'}
if($parallel[0].Extent.Text -notmatch '-ThrottleLimit 4'){throw 'Reviewed four-worker bound changed'}
[pscustomobject]@{SyntheticDnsCaughtLocally=$true;ClassifiedUnreachable=$true;LaterHealthyContinues=$true;NextWatchBatchContinues=$true;ControllerBound=4;EndpointChanges=$false}
