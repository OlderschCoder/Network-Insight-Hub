#Requires -Version 5.1
# Exercise the actual controller predicate with synthetic policy values; never change host policy/trust.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Invoke-BulkDiagnosticsEnrollment.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Controller parse failed.'}
$assignments=@($ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$policyReason'},$true))
if($assignments.Count -ne 1){throw 'Expected the single controller execution-policy predicate.'}
$check=[scriptblock]::Create("param([string]`$machinePolicy,[bool]`$publisher)`n"+$assignments[0].Extent.Text+"`n`$policyReason")
$cases=@(
 @('Restricted',$false,'execution-policy-restricted'),@('Restricted',$true,'execution-policy-restricted'),
 @('AllSigned',$false,'trusted-publisher-missing'),@('Undefined',$false,'trusted-publisher-missing'),
 @('AllSigned',$true,''),@('Undefined',$true,''),@('RemoteSigned',$false,''),@('Unrestricted',$false,''),
 @('Bypass',$true,'execution-policy-review-required'),@('Unknown',$true,'execution-policy-review-required')
)
foreach($case in $cases){$actual=& $check $case[0] $case[1];$matches=if([string]::IsNullOrEmpty($case[2])){[string]::IsNullOrEmpty($actual)}else{$actual -ceq $case[2]};if(-not $matches){throw ('Unexpected execution-policy decision for '+$case[0]+' publisher='+$case[1])}}
[pscustomobject]@{PolicyCasesPassed=$cases.Count;ActualControllerPredicate=$true;ExecutionPolicyChanged=$false;CertificateTrustChanged=$false}
