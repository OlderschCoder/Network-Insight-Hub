#Requires -Version 5.1
[CmdletBinding()]
param([string]$ExporterPath)
$ErrorActionPreference = 'Stop'
if (-not $ExporterPath) { $ExporterPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'Export-AdDiagnosticsInventory.ps1' }
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($ExporterPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Exporter parse failed.' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertTo-DiagnosticsDirectoryFacts' }, $true)
if (-not $definition) { throw 'Directory helper not found.' }
# Extract only this pure read helper. The publisher/provisioning script is never executed.
Invoke-Expression $definition.Extent.Text
$script:reads = 0; $script:mode = 'ok'
$groupId = 'e9db33a2-8eb2-4aec-a9b0-9b6fdcdd41cb'
$groupDn = 'CN=Synthetic-Computers,OU=Groups,DC=sccc,DC=edu'
function Get-ADGroup {
    [CmdletBinding()]
    param([string]$Identity, [string[]]$Properties)
    $script:reads++
    if ($script:mode -eq 'fail') { throw 'Synthetic directory lookup failure.' }
    [pscustomobject]@{ ObjectGUID = [Guid]$groupId; Name = 'Synthetic-Computers'; DistinguishedName = if ($script:mode -eq 'mismatch') { 'CN=Other,DC=sccc,DC=edu' } else { $Identity }; MemberOf = @('CN=Parent,DC=sccc,DC=edu') }
}
$script:passes = 0
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message }; $script:passes++ }
function MustThrow([scriptblock]$Code) { $thrown = $false; try { & $Code | Out-Null } catch { $thrown = $true }; Assert $thrown 'Expected bounded directory failure.' }
$computer = [pscustomobject]@{ DistinguishedName = 'CN=PC,OU=SC-Computers,DC=sccc,DC=edu'; CanonicalName = 'sccc.edu/SC-Computers/PC'; Location = $null; MemberOf = @() }
$cache = @{}
$facts = ConvertTo-DiagnosticsDirectoryFacts $computer $cache
Assert ($facts.memberOf.Count -eq 0 -and $null -eq $facts.location -and $script:reads -eq 0) 'Empty direct membership must remain empty.'
Assert ($facts.distinguishedName -ceq $computer.DistinguishedName -and $facts.canonicalName -ceq $computer.CanonicalName -and -not $facts.Contains('building')) 'Directory identity must not imply a physical building.'
$computer.MemberOf = @($groupDn, $groupDn.ToUpperInvariant()); $computer.Location = 'Recorded AD location'
$facts = ConvertTo-DiagnosticsDirectoryFacts $computer $cache
Assert ($facts.memberOf.Count -eq 1 -and $script:reads -eq 1 -and $facts.memberOf[0].objectGuid -ceq $groupId) 'Direct groups must be cached and deduplicated.'
Assert ($facts.location -ceq $computer.Location) 'Preserve the actual AD location attribute.'
$null = ConvertTo-DiagnosticsDirectoryFacts $computer $cache
Assert ($script:reads -eq 1) 'Repeated computer memberships must reuse the group cache, without recursive lookup.'
$script:mode = 'fail'; MustThrow { ConvertTo-DiagnosticsDirectoryFacts $computer @{} }
$script:mode = 'mismatch'; MustThrow { ConvertTo-DiagnosticsDirectoryFacts $computer @{} }
$script:mode = 'ok'; $computer.MemberOf = @(1..129 | ForEach-Object { $groupDn }); $before = $script:reads
MustThrow { ConvertTo-DiagnosticsDirectoryFacts $computer @{} }
Assert ($script:reads -eq $before) 'Excess membership must fail before any directory lookup.'
$computer.MemberOf = @(); $computer.CanonicalName = $null
MustThrow { ConvertTo-DiagnosticsDirectoryFacts $computer @{} }
Assert ([IO.File]::ReadAllText($ExporterPath).Contains("'SCCC-Diagnostics\Agent\config.json'")) 'Preserve the approved deployed existing-config path.'
[pscustomobject]@{ Tests = $script:passes; Passed = $script:passes; PublisherExecuted = $false; RealDirectoryReads = $false; MembershipWrites = $false; PowerShellVersion = $PSVersionTable.PSVersion.ToString() }
