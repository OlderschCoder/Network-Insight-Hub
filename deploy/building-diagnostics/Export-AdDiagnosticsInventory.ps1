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
    [switch]$PublishInventory,
    [string]$WorkerCredentialPath,
    [ValidatePattern('^[A-Fa-f0-9]{40}$')]
    [string]$SignerThumbprint,
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

function Get-DiagnosticsOrganizationalUnits([string]$DistinguishedName, [object[]]$OrganizationalUnits) {
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $matches = @(foreach ($unit in $OrganizationalUnits) {
        $dn = [string]$unit.DistinguishedName
        $boundary = $DistinguishedName.Length - $dn.Length - 1
        if ($boundary -lt 0 -or -not $DistinguishedName.EndsWith(','+$dn,[StringComparison]::OrdinalIgnoreCase)) { continue }
        # A comma escaped inside a CN is not an RDN boundary. Even runs of
        # backslashes encode a literal backslash followed by a real separator.
        $slashes = 0
        for ($cursor=$boundary-1; $cursor -ge 0 -and $DistinguishedName[$cursor] -eq '\'; $cursor--) { $slashes++ }
        $id = $unit.ObjectGUID.ToString()
        if ($slashes % 2 -eq 0 -and $seen.Add($id)) { [ordered]@{ objectGuid=$id;name=[string]$unit.Name;distinguishedName=$dn } }
    })
    $matches | Sort-Object @{Expression={$_.distinguishedName.Length};Descending=$true}
}

function ConvertTo-DiagnosticsDirectoryFacts([object]$Computer, [hashtable]$GroupCache, [object[]]$OrganizationalUnits=@()) {
    if (-not $Computer.DistinguishedName -or -not $Computer.CanonicalName) { throw 'Complete AD directory identity is required.' }
    $membership = @($Computer.MemberOf)
    if ($membership.Count -gt 128) { throw 'AD computer direct group membership exceeds the reviewed inventory bound.' }
    $groups = @()
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($groupDn in $membership) {
        if ([string]::IsNullOrWhiteSpace([string]$groupDn)) { continue }
        if (-not $GroupCache.ContainsKey([string]$groupDn)) {
            $group = Get-ADGroup -Identity $groupDn -Properties ObjectGUID -ErrorAction Stop
            if ($group.DistinguishedName -ine $groupDn) { throw 'AD group identity did not match the computer membership.' }
            $GroupCache[[string]$groupDn] = [ordered]@{ objectGuid = $group.ObjectGUID.ToString(); name = [string]$group.Name; distinguishedName = [string]$group.DistinguishedName }
        }
        $fact = $GroupCache[[string]$groupDn]
        if ($seen.Add([string]$fact.objectGuid)) { $groups += $fact }
    }
    # These are directory facts, not a physical-building assertion or membership update.
    [ordered]@{ distinguishedName = [string]$Computer.DistinguishedName; canonicalName = [string]$Computer.CanonicalName
        location = if ([string]::IsNullOrWhiteSpace([string]$Computer.Location)) { $null } else { [string]$Computer.Location }
        memberOf = @($groups | Sort-Object objectGuid)
        organizationalUnits = @(Get-DiagnosticsOrganizationalUnits $Computer.DistinguishedName $OrganizationalUnits) }
}

# Resolving the exact OU and reading the whole subtree must both succeed. A
# partial or failed AD query must never be uploaded as an authoritative roster.
$resolvedOu = Get-ADOrganizationalUnit -Identity $SearchBase -ErrorAction Stop
if ($resolvedOu.DistinguishedName -ine $SearchBase) { throw 'OU identity did not match SearchBase.' }
$adDomain = Get-ADDomain -ErrorAction Stop
if ($resolvedOu.ObjectGUID -ne [Guid]'144038ab-232e-4aee-8485-2aa910d4c474' -or $adDomain.ObjectGUID -ne [Guid]'4607c11f-f1a1-4732-bb20-9d26b73b884b' -or $adDomain.DomainSID.Value -cne 'S-1-5-21-4013532473-1306839332-4181249023') { throw 'Pinned SCCC directory domain or workstation OU changed.' }
if (-not $resolvedOu.DistinguishedName.EndsWith(',' + $adDomain.DistinguishedName, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The workstation OU must belong to the authenticated AD domain.'
}
$organizationalUnits = @(Get-ADOrganizationalUnit -Filter * -SearchBase $resolvedOu.DistinguishedName -SearchScope Subtree -ErrorAction Stop | Where-Object { $_.ObjectGUID -ne $resolvedOu.ObjectGUID })
if ($organizationalUnits.Count -gt 5000 -or @($organizationalUnits | Where-Object { -not $_.DistinguishedName.EndsWith(','+$resolvedOu.DistinguishedName,[StringComparison]::OrdinalIgnoreCase) }).Count) { throw 'Unexpected workstation OU hierarchy; no partial inventory.' }
$objects = @(Get-ADComputer -Filter * -SearchBase $resolvedOu.DistinguishedName -SearchScope Subtree `
    -Properties DNSHostName, Enabled, ObjectGUID, OperatingSystem, userAccountControl, DistinguishedName, CanonicalName, Location, MemberOf -ErrorAction Stop |
    Where-Object { $_.OperatingSystem -notmatch 'Server' -and -not ([int]$_.userAccountControl -band 8192) })
if ($objects.Count -eq 0) { throw 'Empty AD roster; refusing to replace the trusted inventory.' }

$groupCache = @{}
$rows = @($objects | Sort-Object Name | ForEach-Object {
    [ordered]@{
        adObjectGuid = $_.ObjectGUID.ToString()
        computerName = $_.Name
        domain = $adDomain.DNSRoot
        enabled = [bool]$_.Enabled
        directory = ConvertTo-DiagnosticsDirectoryFacts $_ $groupCache $organizationalUnits
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

if ($PublishInventory) {
    $origin = Assert-HttpsOrigin $FredOrigin
    $token = [Environment]::GetEnvironmentVariable('BUILDING_DIAGNOSTICS_WORKER_TOKEN', 'Process')
    if ($WorkerCredentialPath) {
        Assert-NoReparsePath $WorkerCredentialPath
        Assert-PrivateDirectory (Split-Path -Parent ([IO.Path]::GetFullPath($WorkerCredentialPath)))
        $credentialAcl = Get-Acl -LiteralPath $WorkerCredentialPath
        foreach ($rule in $credentialAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Worker credential must be private to SYSTEM and Administrators.' }
        }
        Add-Type -AssemblyName System.Security
        $token = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect(
            [IO.File]::ReadAllBytes($WorkerCredentialPath), $null, [Security.Cryptography.DataProtectionScope]::LocalMachine))
    }
    if (-not $token -or $token.Length -lt 32 -or $token -match '\s') { throw 'A protected dedicated worker credential is required.' }
    try {
        if ($PSCmdlet.ShouldProcess($origin, 'Publish complete workstation AD inventory; preserve network evidence')) {
            $body = @{ snapshotComplete = $true; adObservedAt = $snapshot.adObservedAt; adComputers = $rows }
            $null = Invoke-RestMethod -Method Post -Uri ($origin + '/api/building-diagnostics/ad-inventory') `
                -Headers @{ Authorization = 'Bearer ' + $token } -ContentType 'application/json' `
                -Body ($body | ConvertTo-Json -Depth 8 -Compress) -MaximumRedirection 0 -TimeoutSec 30
            Write-Output ('Published {0} AD workstations; no endpoint was enrolled or started.' -f $rows.Count)
        }
    } finally { $token = $null }
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
if (-not $SignerThumbprint) { throw 'The reviewed helper signer thumbprint is required for provisioning.' }
foreach ($fileName in $requiredAgentFiles) {
    if (-not $AgentSourceDirectory -or -not (Test-Path -LiteralPath (Join-Path $AgentSourceDirectory $fileName) -PathType Leaf)) {
        throw 'AgentSourceDirectory must contain the separately reviewed diagnostics installer, module, and runner.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $AgentSourceDirectory $fileName)
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $SignerThumbprint -or
        -not $signature.TimeStamperCertificate) { throw 'Reviewed diagnostics payload signature validation failed.' }
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
            $parentPath = Join-Path $env:ProgramData 'SCCC-Diagnostics'
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
            $stagingPath = Join-Path $env:ProgramData 'SCCC-Diagnostics\Provisioning'
            if ((Test-Path -LiteralPath $stagingPath) -and
                ((Get-Item -LiteralPath $stagingPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'Diagnostics provisioning directory cannot be a reparse point.'
            }
            [pscustomobject]@{ ComputerName = $env:COMPUTERNAME; Domain = $system.Domain; Joined = $system.PartOfDomain
                AlreadyConfigured = (Test-Path -LiteralPath (Join-Path $env:ProgramData 'SCCC-Diagnostics\Agent\config.json')) }
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
            $applicationRoot = Join-Path $env:ProgramData 'SCCC-Diagnostics'
            $directory = Join-Path $applicationRoot 'Provisioning'
            $acl = New-Object Security.AccessControl.DirectorySecurity
            $acl.SetAccessRuleProtection($true, $false)
            $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
            foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
                $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)
                $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
                $acl.AddAccessRule($rule)
            }
            # Secure the new independent root before placing credentials or
            # executable source below it. Never alter the shared SCCC folder.
            if (-not (Test-Path -LiteralPath $applicationRoot)) {
                New-Item -ItemType Directory -Path $applicationRoot | Out-Null
                Set-Acl -LiteralPath $applicationRoot -AclObject $acl
            }
            if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
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
        $remoteStagingDirectory = Invoke-Command -Session $session -ScriptBlock { Join-Path $env:ProgramData 'SCCC-Diagnostics\Provisioning' }
        foreach ($fileName in $requiredAgentFiles) {
            Copy-Item -LiteralPath (Join-Path $AgentSourceDirectory $fileName) -Destination (Join-Path $remoteStagingDirectory $fileName) -ToSession $session
        }
        Invoke-Command -Session $session -ArgumentList $adDomain.DNSRoot,$SignerThumbprint -ScriptBlock {
            param([string]$ExpectedDomain, [string]$ExpectedSigner)
            $directory = Join-Path $env:ProgramData 'SCCC-Diagnostics\Provisioning'
            foreach ($name in @('Install-DiagnosticsAgent.ps1','Invoke-DiagnosticsAgent.ps1','Sccc.Diagnostics.psm1','ExternalProbe.dll')) {
                $signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $directory $name)
                if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ine $ExpectedSigner -or
                    -not $signature.TimeStamperCertificate) { throw 'Remote diagnostics payload signature validation failed.' }
            }
            & (Join-Path $directory 'Install-DiagnosticsAgent.ps1') -ProvisioningFile (Join-Path $directory 'device.json') -ExpectedDomain $ExpectedDomain -SignerThumbprint $ExpectedSigner
            if (-not $?) { throw 'Diagnostics staging failed.' }
        } | Out-Null
        Write-Output ('Provisioned and staged diagnostics only for ' + $computer.Name + '; its task remains disabled.')
    } finally {
        $credential = $null
        $deviceConfig = $null
        Invoke-Command -Session $session -ScriptBlock {
            $path = Join-Path $env:ProgramData 'SCCC-Diagnostics\Provisioning\device.json'
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
        } -ErrorAction SilentlyContinue | Out-Null
        Remove-PSSession -Session $session
    }
}
$headers.Clear()
$workerToken = $null

# SIG # Begin signature block
# MII9ZwYJKoZIhvcNAQcCoII9WDCCPVQCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCChfJIZF7GLqtN5
# UkscuHFs/85dRztHuqkFp4O2rOb/uaCCIiwwggXMMIIDtKADAgECAhBUmNLR1FsZ
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
# 03u4aUoqlmZpxJTG9F9urJh4iIAGXKKy7aIwggbDMIIEq6ADAgECAhMzAAlVUdvE
# /r91E6nTAAAACVVRMA0GCSqGSIb3DQEBDAUAMFoxCzAJBgNVBAYTAlVTMR4wHAYD
# VQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29mdCBJ
# RCBWZXJpZmllZCBDUyBFT0MgQ0EgMDMwHhcNMjYxMDI2MDgwNzIyWhcNMjYxMDI5
# MDgwNzIyWjCBhDELMAkGA1UEBhMCVVMxDzANBgNVBAgTBkthbnNhczEQMA4GA1UE
# BxMHTGliZXJhbDEoMCYGA1UEChMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29s
# bGVnZTEoMCYGA1UEAxMfU2V3YXJkIENvdW50eSBDb21tdW5pdHkgQ29sbGVnZTCC
# AaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBAK02+1IU/cwjyqkN9OzfTfe8
# 5tHEcubkXBod868WZltdhVQBTncTBIq3UnYS5GvTDClGXjPRb8DQNfrH3KakZoIi
# piGjb8xBw06sg6hhni4mtu3hXVFks5N8h2S7SWrb8pSiGIA8ZcnydwaCYFKY/llG
# p25otPmHruRiVXVVGHfQ8ax/hv3+Q8foUlUxXeQCO09kcu1yrwkLqDNcvtbGqDwV
# dhqHXnN+N4qxE2CBYD7NL2cbbhgx46XeyjjrwQsciOXM5HV2O9sjsNwR5Ug3+YDf
# 4fa7ZvWhItEG+tNppP/plWXoRzx1X+jW6uT5omzAbCKdyFkhBJuCq45izVRul2RY
# nGRlquewS60fOo5jEoJ6vpN4dK3EzJsqRcLwPqQjvRiXHBuXXC85z+vU1dyhZN7x
# 2Szwlz2oZAwiyaKsmXD6wURcOZ5qtFL7m7YoK6fXYcw1cl/ZdgV0hVZ8VPzsppiW
# IEb6QyZoep4682g3g/9ipawJyhdWIBQho0g9F0fgSQIDAQABo4IB1TCCAdEwDAYD
# VR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwPAYDVR0lBDUwMwYKKwYBBAGCN2EB
# AAYIKwYBBQUHAwMGGysGAQQBgjdhgpKQiVaC9aWRWIK4/vAosum1djAdBgNVHQ4E
# FgQUSqEVYXNCse+1nL2uOsQEpSxBEswwHwYDVR0jBBgwFoAUa16lNMMFxWJKIVqO
# q3NgYtSsY4UwZwYDVR0fBGAwXjBcoFqgWIZWaHR0cDovL3d3dy5taWNyb3NvZnQu
# Y29tL3BraW9wcy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENTJTIw
# RU9DJTIwQ0ElMjAwMy5jcmwwdAYIKwYBBQUHAQEEaDBmMGQGCCsGAQUFBzAChlho
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDUyUyMEVPQyUyMENBJTIwMDMuY3J0MFQGA1UdIARN
# MEswSQYEVR0gADBBMD8GCCsGAQUFBwIBFjNodHRwOi8vd3d3Lm1pY3Jvc29mdC5j
# b20vcGtpb3BzL0RvY3MvUmVwb3NpdG9yeS5odG0wDQYJKoZIhvcNAQEMBQADggIB
# ADOquN6z+NmS9xqYlTjsrKw23qNfsvKMuFJjmYsMdsE5F8pOlsYhQvWDBkwqHQVn
# BCPEOPBAu7D5emvXLkfdSJ+eUEiN3AOWqg9JEuy3+zkisKkKyf38CrTO7Yf4i63i
# 4qXWELbQhaV5RoqeywqpNI2YJOP9CFqSw37sbZip/zoyYM/N0iHbql0NvPjj/AWV
# TcPDrOP4bTpzjKw64n2D30ZnMtZFu2Zs3LaGJ53lF4B6q19m0L5q93E2+hHFKI7b
# kmxaJO1iFG1DG5mH9aKFG/OlUDoO3T8tzkWYzJPcmqhhIifuO90YgGIvM5gNPU6p
# aaGr3dMoW866TCWYqZV0/G6Fyo85LWi1QHxTf2l0XDCEQ1iE5ncJs/muuZH9k1Rs
# AgZK8f45stX//aM5YhB5ZaUvyA/Vu5KBhsEBOfSfFdzzWAyWkxTIT+R5FMf104uA
# RCBmpqAzZpxL24lWSqposMS8gNhihpSyq3we+AfHWS57ssCYuYYyZbhdWl6YiORX
# 7vR0aQlfizq/NKzcwM7fsyxvbXKDRpCyQ3llJN6cmbvIiB1KrZxRgrd0wwrTCopE
# ITRizA+KFtqVgo/AyC6V0ParpMw5h+CkuOmx4tUhLo/x2lzZtKDm2ADl/D1pkB1D
# TZ2RmPmr5XfhcX6WgL37rhckQSL6x2MefE/jEIBRqCA5MIIGwzCCBKugAwIBAgIT
# MwAJVVHbxP6/dROp0wAAAAlVUTANBgkqhkiG9w0BAQwFADBaMQswCQYDVQQGEwJV
# UzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSswKQYDVQQDEyJNaWNy
# b3NvZnQgSUQgVmVyaWZpZWQgQ1MgRU9DIENBIDAzMB4XDTI2MTAyNjA4MDcyMloX
# DTI2MTAyOTA4MDcyMlowgYQxCzAJBgNVBAYTAlVTMQ8wDQYDVQQIEwZLYW5zYXMx
# EDAOBgNVBAcTB0xpYmVyYWwxKDAmBgNVBAoTH1Nld2FyZCBDb3VudHkgQ29tbXVu
# aXR5IENvbGxlZ2UxKDAmBgNVBAMTH1Nld2FyZCBDb3VudHkgQ29tbXVuaXR5IENv
# bGxlZ2UwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQCtNvtSFP3MI8qp
# DfTs3033vObRxHLm5FwaHfOvFmZbXYVUAU53EwSKt1J2EuRr0wwpRl4z0W/A0DX6
# x9ympGaCIqYho2/MQcNOrIOoYZ4uJrbt4V1RZLOTfIdku0lq2/KUohiAPGXJ8ncG
# gmBSmP5ZRqduaLT5h67kYlV1VRh30PGsf4b9/kPH6FJVMV3kAjtPZHLtcq8JC6gz
# XL7Wxqg8FXYah15zfjeKsRNggWA+zS9nG24YMeOl3so468ELHIjlzOR1djvbI7Dc
# EeVIN/mA3+H2u2b1oSLRBvrTaaT/6ZVl6Ec8dV/o1urk+aJswGwinchZIQSbgquO
# Ys1UbpdkWJxkZarnsEutHzqOYxKCer6TeHStxMybKkXC8D6kI70Ylxwbl1wvOc/r
# 1NXcoWTe8dks8Jc9qGQMIsmirJlw+sFEXDmearRS+5u2KCun12HMNXJf2XYFdIVW
# fFT87KaYliBG+kMmaHqeOvNoN4P/YqWsCcoXViAUIaNIPRdH4EkCAwEAAaOCAdUw
# ggHRMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMDwGA1UdJQQ1MDMGCisG
# AQQBgjdhAQAGCCsGAQUFBwMDBhsrBgEEAYI3YYKSkIlWgvWlkViCuP7wKLLptXYw
# HQYDVR0OBBYEFEqhFWFzQrHvtZy9rjrEBKUsQRLMMB8GA1UdIwQYMBaAFGtepTTD
# BcViSiFajqtzYGLUrGOFMGcGA1UdHwRgMF4wXKBaoFiGVmh0dHA6Ly93d3cubWlj
# cm9zb2Z0LmNvbS9wa2lvcHMvY3JsL01pY3Jvc29mdCUyMElEJTIwVmVyaWZpZWQl
# MjBDUyUyMEVPQyUyMENBJTIwMDMuY3JsMHQGCCsGAQUFBwEBBGgwZjBkBggrBgEF
# BQcwAoZYaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNy
# b3NvZnQlMjBJRCUyMFZlcmlmaWVkJTIwQ1MlMjBFT0MlMjBDQSUyMDAzLmNydDBU
# BgNVHSAETTBLMEkGBFUdIAAwQTA/BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNy
# b3NvZnQuY29tL3BraW9wcy9Eb2NzL1JlcG9zaXRvcnkuaHRtMA0GCSqGSIb3DQEB
# DAUAA4ICAQAzqrjes/jZkvcamJU47KysNt6jX7LyjLhSY5mLDHbBORfKTpbGIUL1
# gwZMKh0FZwQjxDjwQLuw+Xpr1y5H3UifnlBIjdwDlqoPSRLst/s5IrCpCsn9/Aq0
# zu2H+Iut4uKl1hC20IWleUaKnssKqTSNmCTj/QhaksN+7G2Yqf86MmDPzdIh26pd
# Dbz44/wFlU3Dw6zj+G06c4ysOuJ9g99GZzLWRbtmbNy2hied5ReAeqtfZtC+avdx
# NvoRxSiO25JsWiTtYhRtQxuZh/WihRvzpVA6Dt0/Lc5FmMyT3JqoYSIn7jvdGIBi
# LzOYDT1OqWmhq93TKFvOukwlmKmVdPxuhcqPOS1otUB8U39pdFwwhENYhOZ3CbP5
# rrmR/ZNUbAIGSvH+ObLV//2jOWIQeWWlL8gP1buSgYbBATn0nxXc81gMlpMUyE/k
# eRTH9dOLgEQgZqagM2acS9uJVkqqaLDEvIDYYoaUsqt8HvgHx1kue7LAmLmGMmW4
# XVpemIjkV+70dGkJX4s6vzSs3MDO37Msb21yg0aQskN5ZSTenJm7yIgdSq2cUYK3
# dMMK0wqKRCE0YswPihbalYKPwMguldD2q6TMOYfgpLjpseLVIS6P8dpc2bSg5tgA
# 5fw9aZAdQ02dkZj5q+V34XF+loC9+64XJEEi+sdjHnxP4xCAUaggOTCCBygwggUQ
# oAMCAQICEzMAAAAVBT5uGY6TKdkAAAAAABUwDQYJKoZIhvcNAQEMBQAwYzELMAkG
# A1UEBhMCVVMxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjE0MDIGA1UE
# AxMrTWljcm9zb2Z0IElEIFZlcmlmaWVkIENvZGUgU2lnbmluZyBQQ0EgMjAyMTAe
# Fw0yNjAzMjYxODExMjhaFw0zMTAzMjYxODExMjhaMFoxCzAJBgNVBAYTAlVTMR4w
# HAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKzApBgNVBAMTIk1pY3Jvc29m
# dCBJRCBWZXJpZmllZCBDUyBFT0MgQ0EgMDMwggIiMA0GCSqGSIb3DQEBAQUAA4IC
# DwAwggIKAoICAQDg9Ms9AqovDnMePvMOe+KybhCd8+lokzYORlS3kBVXseecbyGw
# Bcsenlm5bLtMGPjiIFLzBQF+ghlVV/U29q5GcdeEEBCHTTGhL2koIrLc4UrliMRc
# bv9mOMtR/l7/xAmv0Fx4BJHn1dHt37fvrBqXmKjKfGf5DpyO/+hnV7TEreMtS19i
# O+bjZ/9Hnpg3PCk0e7YSbRTFkx97FZwRWpC4s3NepRfRXQh/WMAj7JmsYeVZohi4
# TF5yW2JMrJZqwHcyzJZYtD2Hlno5ZEJkdiZcEaxHOobmwO06Z1J9c23ps9PGIhGa
# q1sKLEAz9Doc5rLkYWGteDrscKhAp2kIc/oYlH9Ij6BkOqqgWINEkEtC8ZNG1Mak
# +h3o65aj0iQKmdxW7IZaHO5cuyoMi+KtYfXeIIg3sVIbS2EL8kUtsDGdEqNqAq/i
# sqTi1jXqLe6iKp1ni1SPdvPW9G03CTsYF68b/yuIQRwbdoBCXemMNJCS0dorCRY4
# b2WAAy4ng7SANcEgrBgZf535+QfLU5hGzrKjIpbMabauWb5FKWUKkMsPcXFkXRWO
# 4noKPm4KWlFypqOpbJ/KONVReIlxHQRegAOBzIhRB7gr9IDQ1sc2MgOgQ+xVGW4o
# q4HD0mfAiwiyLskZrkaQ7JoanYjBNcR9RS26YxAVbcBtLitFTzCIEg5ZdQIDAQAB
# o4IB3DCCAdgwDgYDVR0PAQH/BAQDAgGGMBAGCSsGAQQBgjcVAQQDAgEAMB0GA1Ud
# DgQWBBRrXqU0wwXFYkohWo6rc2Bi1KxjhTBUBgNVHSAETTBLMEkGBFUdIAAwQTA/
# BggrBgEFBQcCARYzaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9Eb2Nz
# L1JlcG9zaXRvcnkuaHRtMBkGCSsGAQQBgjcUAgQMHgoAUwB1AGIAQwBBMBIGA1Ud
# EwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAU2UEpsA8PY2zvadf1zSmepEhqMOYw
# cAYDVR0fBGkwZzBloGOgYYZfaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9w
# cy9jcmwvTWljcm9zb2Z0JTIwSUQlMjBWZXJpZmllZCUyMENvZGUlMjBTaWduaW5n
# JTIwUENBJTIwMjAyMS5jcmwwfQYIKwYBBQUHAQEEcTBvMG0GCCsGAQUFBzAChmFo
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NlcnRzL01pY3Jvc29mdCUy
# MElEJTIwVmVyaWZpZWQlMjBDb2RlJTIwU2lnbmluZyUyMFBDQSUyMDIwMjEuY3J0
# MA0GCSqGSIb3DQEBDAUAA4ICAQBdbiI8zwXLX8glJEh/8Q22UMCUhWBO46Z9FPhw
# OR3mdlqRVLkYOon/MczUwrjDhx3X99SPH5PSflkGoTvnO9ZWHM5YFVYpO7NYuB+m
# fVSGAGZwiGOASWk0i2B7vn9nElJJmoiXxugfH5YdBsrUgTt0AFNXkzmqTgk+S1Hx
# b1u/0HCqEHVZPk2A/6eJXYbtpRM5Fcz00jisUl9BRZgSebODV85bBzOveqyC3f0P
# nHCxRJNhMb8xP/sB/VI7pf2rheSV7zqUSv8vn/fIMblXeaVIlpqoq8SP9BJMjE/C
# oVXJxnkZQRM1Fa7kN9yztvReOhxSgPgpZx/Xl/jkwyEFVJTBfBp3sTgfIc/pmqv2
# ehtakL2AEj78EmOPQohxJT3wyX+P78GA25tLpAvzj3RMMHd8z18ZuuVi+60MAzGp
# OASH1L8Nlr3fZRZnQO+pyye2DCvYmHaIfdUgYJqn7noxxGVv89+RaETh1tgCDvwN
# pFCSG7vl5A4ako+2fx409r9TWjXC7Oif1IQ5ZJzB4Rf8GvBiHYjvMmHpledp1FGR
# LdSRFVpC3/OKpZY6avIqZp7+8pP/WQP903DdgrvAT6W4xPOBxXPa4tGksN3SuqJa
# iFYHSNyeBufn8iseujW4IbBSbHD4BPqbF3qZ+7nG9d/d/G2/Lx4kH9cCmBfmsZdS
# kHmukDCCB54wggWGoAMCAQICEzMAAAAHh6M0o3uljhwAAAAAAAcwDQYJKoZIhvcN
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
# iuGjH2TdaC1ZOmBXiCRKJLj4DT2uhJ04ji+tHD6n58vhavFIrmcxghqRMIIajQIB
# ATBxMFoxCzAJBgNVBAYTAlVTMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRp
# b24xKzApBgNVBAMTIk1pY3Jvc29mdCBJRCBWZXJpZmllZCBDUyBFT0MgQ0EgMDMC
# EzMACVVR28T+v3UTqdMAAAAJVVEwDQYJYIZIAWUDBAIBBQCgXjAQBgorBgEEAYI3
# AgEMMQIwADAZBgkqhkiG9w0BCQMxDAYKKwYBBAGCNwIBBDAvBgkqhkiG9w0BCQQx
# IgQgNaxuIjm4ERKjdaObvO7ZUl9//4OVz1miGQtzSAbbtr8wDQYJKoZIhvcNAQEB
# BQAEggGAAkFr5V0zTO26jvnVzdgUb1EErQTXNCugHqqyXeH/GdX3GWt2d/Ewiuso
# HnnD7vfBR5laD15RWv0lK9tOYYRNS+8R0T1NbN3qj1WtBmVedZzkne/GQwt00hlD
# N5p4iGiXOocaJ+HuzAIGdSZ57hcEOfSbsl08EUZMexP2z3/zWPPNSv74YC3qxRdj
# hSOwL52zSrkOuH9s0B6YeMqWkaBroEZQuy2Mqs01GHm/Nc9R+Yi25D16Y/Jzt83O
# NTbIrMW+JJgDbW8zlZ7gHV9rhscMakCQMHbTI42bewZHjiOmmt/qnukTNS1HZcI8
# DDv74dOwzXqkx9twwfDS1GJz6tMd/X8ov2Q2Ue/tDbQDyK9RVDhX4wRrd95AAh+5
# IkDS/PXLdR1AwZ8FpKG3mS79o5QIHBjN5RW6Zv1WUURaNmGwd7ICEq7sYUCjReoa
# bbdqBtIHdxnuBCAppJ7zYUlCS/lu8g/yKcd3lXsPtd6D3iU13d0cqH+kDytkMc3s
# kWc77DszoYIYETCCGA0GCisGAQQBgjcDAwExghf9MIIX+QYJKoZIhvcNAQcCoIIX
# 6jCCF+YCAQMxDzANBglghkgBZQMEAgEFADCCAWIGCyqGSIb3DQEJEAEEoIIBUQSC
# AU0wggFJAgEBBgorBgEEAYRZCgMBMDEwDQYJYIZIAWUDBAIBBQAEIE3ukqyljbh1
# Mlkzd7vOZpHy6mLLXEyhaxp7TBtQT/KlAgZq202RdaEYEzIwMjYxMDI3MTAyMDEz
# LjY3N1owBIACAfSggeGkgd4wgdsxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNo
# aW5ndG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29y
# cG9yYXRpb24xJTAjBgNVBAsTHE1pY3Jvc29mdCBBbWVyaWNhIE9wZXJhdGlvbnMx
# JzAlBgNVBAsTHm5TaGllbGQgVFNTIEVTTjo3QTAwLTA1RTAtRDk0NzE1MDMGA1UE
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
# 2GwYe6ZoAF1bMIIHlzCCBX+gAwIBAgITMwAAAF3GOXhPQH0z/QAAAAAAXTANBgkq
# hkiG9w0BAQwFADBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENv
# cnBvcmF0aW9uMTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3Rh
# bXBpbmcgQ0EgMjAyMDAeFw0yNjA5MTcxODU3MjFaFw0yNzA5MTQxODU3MjFaMIHb
# MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVk
# bW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSUwIwYDVQQLExxN
# aWNyb3NvZnQgQW1lcmljYSBPcGVyYXRpb25zMScwJQYDVQQLEx5uU2hpZWxkIFRT
# UyBFU046N0EwMC0wNUUwLUQ5NDcxNTAzBgNVBAMTLE1pY3Jvc29mdCBQdWJsaWMg
# UlNBIFRpbWUgU3RhbXBpbmcgQXV0aG9yaXR5MIICIjANBgkqhkiG9w0BAQEFAAOC
# Ag8AMIICCgKCAgEAnfeo3PEUD4ms6oOxxnr50+xXsYIC89uEGj2MMjXhwsmk31IR
# N7u7diRWxUr1PfVqZUQSwpJ0NlB4Np5ImpQ2wio7MbAEu7GT9fw2VlGJBdanG87g
# NKKRr91ipU6R+HS2vsmGSAkX1uKg/LAuUttZ9HMk4IZPt2jyP/UsUxNB8MEsDb+1
# jVODSksDGZytN2ImF85UbZ84sAGzkIwapHjVjLIOcI07nfunp/8psYD+l4G6TTV+
# QI9KyBKpHGg945xF5Bju8jo7auPPnHvMSj2hzGfnZKw8FlPqmAepuXClZRvpvtqH
# PLze6bgMLRIy9R/SGyb/T7723i9CavF5VxM11REBvBcNQtX1QvZ3zWqMPpk9u4sK
# gnacVVrB6V2+z1gl5PiaEbQ6k/7sii90m7buyp1nhPxtVaup3up25vs0kAOaOJPO
# nzG4uZCsB0NH8+EENAWCDP6PzxLnVmbKJwdydCRW0Q8qL+SyIdJXMrKx85c4MTNr
# 0hmnjmatRWP8lMij6edIYWPLxIWx5dJOYn4aVEmF5GeFAoZRKxzPQw1jfUQnEA7x
# J0+olpHbPfQbxi8k2BOLSlQzHR5vAa2q4X+X7KPgXV/PRIOYJnUuKSqmk0Sy2LEk
# fBrfZ9v35qpv5QYFH8DWGvShGglZsBuJMIXVLIyT1siEJ89fYmAsMM39jM0CAwEA
# AaOCAcswggHHMB0GA1UdDgQWBBRD2wpdmU7wfh5W7f3lqGjIf1rnuTAfBgNVHSME
# GDAWgBRraSg6NS9IY0DPe9ivSek+2T3bITBsBgNVHR8EZTBjMGGgX6BdhltodHRw
# Oi8vd3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NybC9NaWNyb3NvZnQlMjBQdWJs
# aWMlMjBSU0ElMjBUaW1lc3RhbXBpbmclMjBDQSUyMDIwMjAuY3JsMHkGCCsGAQUF
# BwEBBG0wazBpBggrBgEFBQcwAoZdaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3Br
# aW9wcy9jZXJ0cy9NaWNyb3NvZnQlMjBQdWJsaWMlMjBSU0ElMjBUaW1lc3RhbXBp
# bmclMjBDQSUyMDIwMjAuY3J0MAwGA1UdEwEB/wQCMAAwFgYDVR0lAQH/BAwwCgYI
# KwYBBQUHAwgwDgYDVR0PAQH/BAQDAgeAMGYGA1UdIARfMF0wUQYMKwYBBAGCN0yD
# fQEBMEEwPwYIKwYBBQUHAgEWM2h0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2lv
# cHMvRG9jcy9SZXBvc2l0b3J5Lmh0bTAIBgZngQwBBAIwDQYJKoZIhvcNAQEMBQAD
# ggIBAELIRPApwy7XbiTh4WhtQ6gKfJeKC1/pHJUNX+CMvvdgV8Feg7o4paA4m/pC
# s0+vNxB/LSQLrSzjZgJrhpRaATTi2ih2jaUcn12Kaxfa+BjVHMysfIYjGY9GhIla
# ZR1m+sPaktieppf8rIz/lX8+Wx7ozgaFEYnU076R6tCbF3VxO5/BybUrXHMIMocN
# tQZ7eQtHcwE2wgotoGzmz0uU2gJiL7nWvl4fatCUctOWBCYOH90rTvdUON0+VtAB
# pas/mhXurQypBVWbITPirdcHiEqAe2KcUHMCeazBsUvhHfIsQ0KxHeIPADpYJkVR
# NMxBCighDoitsHLQX74/4cIk8xKPo6CQ5eY1AUIuWY6DiXQ4FmjVOg+gIEMieDyO
# QiukmMTdMc6YK3kYH/XbyxkSUKzs6Gr8HkkBZiU3syLke3CadevKdo/hFXSPZuLW
# WvV5hjo3ad8x4Pg3oWouH9vP+wmrrDzVKa/pnHRYRkCic+lJKCMc+4IFc8w9g5SC
# koU+n4nCxgwCO68qPyacs1OGxlVq34wfwwdCILMR7ctM5voCfP6r7G67X4PUfXW5
# DJwo6ZHed1zroRj4jIaxZ5L9INnuS9cValdwr+NYIm5nk5sQAJzBp7u6UbvyGbtW
# XYPNtx2Jvv8RNYTTzPqaFaJ2YzmaYOts5AbDvyRH2vNhyZNKMYIHQzCCBz8CAQEw
# eDBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
# MTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0Eg
# MjAyMAITMwAAAF3GOXhPQH0z/QAAAAAAXTANBglghkgBZQMEAgEFAKCCBJwwEQYL
# KoZIhvcNAQkQAg8xAgUAMBoGCSqGSIb3DQEJAzENBgsqhkiG9w0BCRABBDAcBgkq
# hkiG9w0BCQUxDxcNMjYxMDI3MTAyMDEzWjAvBgkqhkiG9w0BCQQxIgQgFhf0dN8b
# DjEC2gUEUW6pNf0cZEIGrGfOEeZHH1cITyQwgbkGCyqGSIb3DQEJEAIvMYGpMIGm
# MIGjMIGgBCAtNWRLb+nz7kJioWWnRqK5hoUAQ15v3MvrF73cxAJKXTB8MGWkYzBh
# MQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMTIw
# MAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0EgMjAy
# MAITMwAAAF3GOXhPQH0z/QAAAAAAXTCCA14GCyqGSIb3DQEJEAISMYIDTTCCA0mh
# ggNFMIIDQTCCAikCAQEwggEJoYHhpIHeMIHbMQswCQYDVQQGEwJVUzETMBEGA1UE
# CBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9z
# b2Z0IENvcnBvcmF0aW9uMSUwIwYDVQQLExxNaWNyb3NvZnQgQW1lcmljYSBPcGVy
# YXRpb25zMScwJQYDVQQLEx5uU2hpZWxkIFRTUyBFU046N0EwMC0wNUUwLUQ5NDcx
# NTAzBgNVBAMTLE1pY3Jvc29mdCBQdWJsaWMgUlNBIFRpbWUgU3RhbXBpbmcgQXV0
# aG9yaXR5oiMKAQEwBwYFKw4DAhoDFQC9p7q1tbGAzwdowGwPEcSazJaQ9aBnMGWk
# YzBhMQswCQYDVQQGEwJVUzEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9u
# MTIwMAYDVQQDEylNaWNyb3NvZnQgUHVibGljIFJTQSBUaW1lc3RhbXBpbmcgQ0Eg
# MjAyMDANBgkqhkiG9w0BAQsFAAIFAO6KaU4wIhgPMjAyNjEwMjcwMDA1MzRaGA8y
# MDI2MTAyODAwMDUzNFowdDA6BgorBgEEAYRZCgQBMSwwKjAKAgUA7oppTgIBADAH
# AgEAAgISEzAHAgEAAgISbjAKAgUA7ou6zgIBADA2BgorBgEEAYRZCgQCMSgwJjAM
# BgorBgEEAYRZCgMCoAowCAIBAAIDB6EgoQowCAIBAAIDAYagMA0GCSqGSIb3DQEB
# CwUAA4IBAQCWDSYr5023gCmbLMBJiOolI1wiJdcxoVOLWpUH1V+NDsU65qOw18sW
# XTprVfRs7Umn3slYVVN1i/DrBPqJ08rUAW324FEh9HFNOoC/v/IYlCpl+/fsD/k9
# ccA2WVkYrUE3zgGHUtvHNSN/RWK3ZNj9kk7YfXje4oT9OTRXbBQMoKUVsra9ncSJ
# EWIKianunXB4HThsVOEZnsWqyA/Tp6mmAFokCsTa9FD91zs57pSNdk/r4ox1XXiI
# cOIf2gni5uRjiThcUAXyAO1aDwv66/tQZ84Fcxrd4KGLzjHfKUhIdiUZLECpxhP3
# M03kFB3O3m7bkDPM3MsKjaa2dwNBv5bZMA0GCSqGSIb3DQEBAQUABIICAF/AHHdw
# qH0lMDVHzje5Ht+UXy668/j5pVfSRhjX4E0fUvWXuHq27gFcNUtYMn69Nrl+KZYb
# wg31W2EQYPdL6uBH9YA4d3Mc6xy9/G+1BqdkrwuIaMskCwv9rmfwfqrWr2+SPTrq
# VGp9d4qchlf4B8jvrAme0B8OcdxTdrA1jvEGyzvkH6ilC8j0KIJCmC4Ci/faAgGL
# +JiChLCunot+yTtZVrl+XmxbLVxEzjjz1/LMLIjyUvKihVmzmI1mgOZgl+kud4zI
# 34EMVwXffqRPmaw+W10GhxuYTPLZdFV489WSpFwQtBs0w2mQ7K0VuVqPZGLaWA62
# IDuTPJHe13LJwvJOCvLR1t1v7Y1CCq5WAvu9NYjM++8W4QBsAh2HouxZ96gY4r4F
# cXwkkIEU+2oOvARFMNMqlisZg3gWB3SAa+bhEE8bLFDERGuY7OeEQsBgMXXdgNo2
# rAH4ls8iqQUANnehedjHnwaQ4tAxq1RESnvxzwCGUgMzrzd06rJVdq0vdu6W5M6N
# kGec9MwZ98Bai3G7GdwUQwGWgEAj6ZsLNnPcoHKA50izls29izcqgVgtrnQ7R2Yp
# Xxv4IccKU5NtfEdWjrsSCNOSESsZ3P127LrxquttYzRPkWP3x/69H1GfUrV3NiaP
# 4zaBUMrQkgbv/8YGPQUTPud5aFqgGCg/O/ze
# SIG # End signature block
