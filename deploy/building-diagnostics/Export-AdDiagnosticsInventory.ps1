#Requires -Version 5.1
#Requires -RunAsAdministrator
#Requires -Modules ActiveDirectory
<#
.SYNOPSIS
Exports the complete workstation OU roster; optionally provisions named pilots.
.DESCRIPTION
Run as an authorized domain operator. SearchBase must be the resolved SC-Computers
distinguished name. No OU lookup by substring, remote shell supplied by the API,
GPO linking, task activation, alert credentials, or MFA keys are involved.
The worker credential comes only from this operator's protected environment.
Remote device provisioning uses WinRM Kerberos, the AD object's DNSHostName, and
checks its computer name/domain locally before writing its own device credential.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(?i)OU=SC-Computers,')]
    [string]$SearchBase,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [string]$FredOrigin,
    [string]$AgentSourceDirectory,
    [string]$ExternalProbeOrigin,
    [switch]$PermitSustained,
    [string[]]$ProvisionComputerName = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Assert-HttpsOrigin([string]$Value) {
    $uri = [Uri]$Value
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or
        -not $uri.IsDefaultPort -or $uri.UserInfo -or $uri.Query -or
        $uri.Fragment -or $uri.AbsolutePath -ne '/') {
        throw 'FredOrigin must be one HTTPS origin with no path or credentials.'
    }
    $uri.GetLeftPart([UriPartial]::Authority)
}

function Set-PrivateAcl([string]$Path, [bool]$Directory) {
    $security = if ($Directory) { New-Object Security.AccessControl.DirectorySecurity }
                else { New-Object Security.AccessControl.FileSecurity }
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
    foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
        $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)
        if ($Directory) {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        } else {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
        }
        $security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $security
}

function Assert-NoReparsePath([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are not allowed in a diagnostics credential/inventory path.' }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Assert-PrivateDirectory([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    $allowed = @('S-1-5-18', 'S-1-5-32-544')
    $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -notin $allowed) { throw 'Existing inventory directory must be owned by SYSTEM or Administrators.' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) {
            throw 'Use a dedicated private inventory directory; permissions on an existing general-purpose directory will not be changed.'
        }
    }
}

# Resolving the exact OU and reading the whole subtree must both succeed. A
# partial or failed AD query must never be uploaded as an authoritative roster.
$resolvedOu = Get-ADOrganizationalUnit -Identity $SearchBase -ErrorAction Stop
if ($resolvedOu.DistinguishedName -ine $SearchBase) { throw 'OU identity did not match SearchBase.' }
$adDomain = Get-ADDomain -ErrorAction Stop
if (-not $resolvedOu.DistinguishedName.EndsWith(',' + $adDomain.DistinguishedName, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The workstation OU must belong to the authenticated AD domain.'
}
$objects = @(Get-ADComputer -Filter * -SearchBase $resolvedOu.DistinguishedName -SearchScope Subtree `
    -Properties DNSHostName, Enabled, ObjectGUID -ErrorAction Stop)
if ($objects.Count -eq 0) { throw 'Empty AD roster; refusing to replace the trusted inventory.' }

$rows = @($objects | Sort-Object Name | ForEach-Object {
    [ordered]@{
        adObjectGuid = $_.ObjectGUID.ToString()
        computerName = $_.Name
        domain = $adDomain.DNSRoot
        enabled = [bool]$_.Enabled
    }
})
$snapshot = [ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString('o')
    snapshotComplete = $true
    adComputers = $rows
    observations = @()
    userBuildingAssignments = @()
}
$snapshot['adObservedAt'] = $snapshot['generatedAt']

$absoluteOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $absoluteOutput
$snapshotWritten = $false
if ($PSCmdlet.ShouldProcess($absoluteOutput, 'Write complete AD diagnostics inventory')) {
    Assert-NoReparsePath $absoluteOutput
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $outputDirectory | Out-Null
        Set-PrivateAcl $outputDirectory $true
    } else {
        Assert-PrivateDirectory $outputDirectory
    }
    $temporary = Join-Path $outputDirectory ([IO.Path]::GetRandomFileName())
    try {
        [IO.File]::WriteAllText($temporary, ($snapshot | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        Set-PrivateAcl $temporary $false
        Move-Item -LiteralPath $temporary -Destination $absoluteOutput -Force
        $snapshotWritten = $true
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

if ($ProvisionComputerName.Count -eq 0) {
    if ($snapshotWritten) { Write-Output ('Exported complete AD roster with {0} computers. No computer was provisioned.' -f $rows.Count) }
    else { Write-Output ('Read {0} AD computers. No inventory file was written and no computer was provisioned.' -f $rows.Count) }
    return
}
$origin = Assert-HttpsOrigin $FredOrigin
$externalOrigin = if ($ExternalProbeOrigin) { Assert-HttpsOrigin $ExternalProbeOrigin } else { '' }
if ($PermitSustained -and -not $externalOrigin) { throw 'Sustained opt-in requires an explicitly reviewed external HTTPS origin.' }
$workerToken = [Environment]::GetEnvironmentVariable('BUILDING_DIAGNOSTICS_WORKER_TOKEN', 'Process')
if (-not $workerToken -or $workerToken.Length -lt 32 -or $workerToken -match '\s') {
    throw 'A dedicated worker credential must already be present in the protected operator environment.'
}
$headers = @{ Authorization = 'Bearer ' + $workerToken }
$requiredAgentFiles = @('Install-DiagnosticsAgent.ps1', 'Invoke-DiagnosticsAgent.ps1', 'Sccc.Diagnostics.psm1', 'ExternalProbe.dll')
foreach ($fileName in $requiredAgentFiles) {
    if (-not $AgentSourceDirectory -or -not (Test-Path -LiteralPath (Join-Path $AgentSourceDirectory $fileName) -PathType Leaf)) {
        throw 'AgentSourceDirectory must contain the separately reviewed diagnostics installer, module, and runner.'
    }
}

# Provisioning must not silently replace the current network/phone observations
# with an AD-only export. Publish the joined inventory using pull_worker.py first.
# Fred independently verifies each requested AD GUID/name/domain against that
# current complete roster before issuing a device-only credential.
foreach ($requestedName in ($ProvisionComputerName | Sort-Object -Unique)) {
    $matches = @($objects | Where-Object { $_.Name -ieq $requestedName -and $_.Enabled })
    if ($matches.Count -ne 1 -or -not $matches[0].DNSHostName) {
        throw ('Pilot is not one enabled AD object with a DNS hostname: ' + $requestedName)
    }
    $computer = $matches[0]
    if (-not $PSCmdlet.ShouldProcess($computer.DNSHostName, 'Provision an independent diagnostics credential; no task start')) { continue }
    $session = New-PSSession -ComputerName $computer.DNSHostName -Authentication Kerberos -ErrorAction Stop
    try {
        # Authenticate the remote host before issuing any credential. Kerberos
        # authenticates the AD hostname; local checks protect stale object/name.
        $identity = Invoke-Command -Session $session -ScriptBlock {
            $system = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
            $parentPath = Join-Path $env:ProgramData 'SCCC'
            if (Test-Path -LiteralPath $parentPath) {
                if ((Get-Item -LiteralPath $parentPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw 'SCCC application parent cannot be a reparse point.'
                }
                $parentAcl = Get-Acl -LiteralPath $parentPath
                $trusted = @('S-1-5-18', 'S-1-5-32-544')
                if ($parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) {
                    throw 'SCCC application parent must have a trusted system/administrator owner.'
                }
                $unsafeRights = [Security.AccessControl.FileSystemRights]'WriteData,AppendData,WriteExtendedAttributes,WriteAttributes,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
                foreach ($rule in $parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
                    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted -and
                        -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
                        ($rule.FileSystemRights -band $unsafeRights)) {
                        throw 'SCCC application parent is writable by another principal; review it before provisioning.'
                    }
                }
            }
            $stagingPath = Join-Path $env:ProgramData 'SCCC\DiagnosticsProvisioning'
            if ((Test-Path -LiteralPath $stagingPath) -and
                ((Get-Item -LiteralPath $stagingPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'Diagnostics provisioning directory cannot be a reparse point.'
            }
            [pscustomobject]@{ ComputerName = $env:COMPUTERNAME; Domain = $system.Domain; Joined = $system.PartOfDomain
                AlreadyConfigured = (Test-Path -LiteralPath (Join-Path $env:ProgramData 'SCCC\Diagnostics\config.json')) }
        }
        if (-not $identity.Joined -or $identity.ComputerName -ine $computer.Name -or
            $identity.Domain -ine $adDomain.DNSRoot) { throw 'Kerberos pilot identity did not match its AD object.' }
        if ($identity.AlreadyConfigured) { throw 'Computer already has diagnostics configuration. Review credential rotation explicitly.' }
        $body = @{ adObjectGuid = $computer.ObjectGUID.ToString(); computerName = $computer.Name; domain = $adDomain.DNSRoot }
        $credential = Invoke-RestMethod -Method Post -Uri ($origin + '/api/building-diagnostics/devices/provision') `
            -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json) -MaximumRedirection 0 -TimeoutSec 30
        if (-not $credential.deviceId -or -not $credential.deviceToken) { throw 'Fred did not return a device-only credential.' }
        $deviceConfig = @{ serverUrl = $origin; deviceId = [string]$credential.deviceId; deviceToken = [string]$credential.deviceToken
            computerName = $computer.Name; domain = $adDomain.DNSRoot; externalProbeOrigin = $externalOrigin; permitSustained = [bool]$PermitSustained }
        Invoke-Command -Session $session -ArgumentList ($deviceConfig | ConvertTo-Json -Compress) -ScriptBlock {
            param([string]$ConfigJson)
            $directory = Join-Path $env:ProgramData 'SCCC\DiagnosticsProvisioning'
            if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
            $acl = New-Object Security.AccessControl.DirectorySecurity
            $acl.SetAccessRuleProtection($true, $false)
            $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
            foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
                $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)
                $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
                $acl.AddAccessRule($rule)
            }
            Set-Acl -LiteralPath $directory -AclObject $acl
            $path = Join-Path $directory 'device.json'
            [IO.File]::WriteAllText($path, $ConfigJson, (New-Object Text.UTF8Encoding($false)))
            $fileAcl = New-Object Security.AccessControl.FileSecurity
            $fileAcl.SetAccessRuleProtection($true, $false)
            $fileAcl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
            foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
                $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)
                $fileAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')))
            }
            Set-Acl -LiteralPath $path -AclObject $fileAcl
            $null = $ConfigJson
        } | Out-Null
        $remoteStagingDirectory = Invoke-Command -Session $session -ScriptBlock { Join-Path $env:ProgramData 'SCCC\DiagnosticsProvisioning' }
        foreach ($fileName in $requiredAgentFiles) {
            Copy-Item -LiteralPath (Join-Path $AgentSourceDirectory $fileName) -Destination (Join-Path $remoteStagingDirectory $fileName) -ToSession $session
        }
        Invoke-Command -Session $session -ArgumentList $adDomain.DNSRoot -ScriptBlock {
            param([string]$ExpectedDomain)
            $directory = Join-Path $env:ProgramData 'SCCC\DiagnosticsProvisioning'
            & (Join-Path $directory 'Install-DiagnosticsAgent.ps1') -ProvisioningFile (Join-Path $directory 'device.json') -ExpectedDomain $ExpectedDomain
            if (-not $?) { throw 'Diagnostics staging failed.' }
        } | Out-Null
        Write-Output ('Provisioned and staged diagnostics only for ' + $computer.Name + '; its task remains disabled.')
    } finally {
        $credential = $null
        $deviceConfig = $null
        Invoke-Command -Session $session -ScriptBlock {
            $path = Join-Path $env:ProgramData 'SCCC\DiagnosticsProvisioning\device.json'
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        } -ErrorAction SilentlyContinue | Out-Null
        Remove-PSSession -Session $session
    }
}
$headers.Clear()
$workerToken = $null
