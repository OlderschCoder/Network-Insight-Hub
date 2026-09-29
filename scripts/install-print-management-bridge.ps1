[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ListenAddress = '127.0.0.1',
    [ValidateRange(1, 65535)][int]$Port = 9124,
    [string[]]$AllowedClients = @(),
    [switch]$AllowPrivateHttp,
    [switch]$RotateToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ConfigurationRoot = 'C:\ProgramData\SCCC\FredPrinterBridge'
$TaskName = 'SCCC Fred Printer Bridge'
$FirewallRuleName = 'SCCC-Fred-Printer-Bridge'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer from an elevated PowerShell session on PRNTSP2.'
}
if ($env:COMPUTERNAME -ine 'PRNTSP2') {
    throw 'This bridge may be installed only on PRNTSP2.'
}

$sourceScript = Join-Path $PSScriptRoot 'print-management-bridge.ps1'
if (-not (Test-Path -LiteralPath $sourceScript -PathType Leaf)) {
    throw "Bridge source script not found: $sourceScript"
}

$fixedPrivateHosts = @('10.0.0.30', 'prntsp2.sccc.edu')
$loopbackHosts = @('127.0.0.1', 'localhost', '::1', '[::1]')
$isLoopback = $ListenAddress.ToLowerInvariant() -in $loopbackHosts
if (-not $isLoopback -and
    (-not $AllowPrivateHttp -or $ListenAddress.ToLowerInvariant() -notin $fixedPrivateHosts)) {
    throw 'A non-loopback HTTP listener requires -AllowPrivateHttp and must be 10.0.0.30 or prntsp2.sccc.edu.'
}
if (-not $isLoopback -and $AllowedClients.Count -eq 0) {
    throw 'A non-loopback listener requires one or more exact -AllowedClients IP addresses.'
}
if ($isLoopback -and $AllowedClients.Count -eq 0) {
    $AllowedClients = @('127.0.0.1', '::1')
}

# The installer verifies the listener through its configured address. Keep the
# server's own source address in both the application and firewall allowlists.
$localClientAddresses = if ($isLoopback) {
    @('127.0.0.1', '::1')
} else {
    @('10.0.0.30')
}
$AllowedClients = @($AllowedClients) + $localClientAddresses

$validatedClients = foreach ($client in $AllowedClients) {
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($client, [ref]$parsed) -or
        $parsed.Equals([Net.IPAddress]::Any) -or
        $parsed.Equals([Net.IPAddress]::IPv6Any)) {
        throw "Invalid allowed-client address: $client"
    }
    if ($parsed.IsIPv4MappedToIPv6) { $parsed = $parsed.MapToIPv4() }
    $parsed.ToString()
}
$AllowedClients = @($validatedClients | Sort-Object -Unique)

function New-RestrictedDirectoryAcl {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
        $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance, $propagation, $allow
        ))
    }
    return $acl
}

function New-RestrictedFileAcl {
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $allow = [Security.AccessControl.AccessControlType]::Allow
    foreach ($sidValue in @('S-1-5-18', 'S-1-5-32-544')) {
        $sid = [Security.Principal.SecurityIdentifier]::new($sidValue)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [Security.AccessControl.FileSystemRights]::FullControl, $allow
        ))
    }
    return $acl
}

function Test-RestrictedFileAcl {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $allowedSids = @('S-1-5-18', 'S-1-5-32-544')
    try {
        foreach ($rule in (Get-Acl -LiteralPath $Path).Access) {
            if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($sid -notin $allowedSids) { return $false }
        }
        return $true
    } catch {
        return $false
    }
}

function New-RandomBridgeToken {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    } finally {
        $rng.Dispose()
    }
}

$configPath = Join-Path $ConfigurationRoot 'config.json'
$installedScript = Join-Path $ConfigurationRoot 'print-management-bridge.ps1'
$existingAclWasRestricted = Test-RestrictedFileAcl -Path $configPath
$existingToken = ''
if ($existingAclWasRestricted -and -not $RotateToken) {
    try {
        $existingConfiguration = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -ErrorAction Stop
        $existingToken = [string]$existingConfiguration.token
    } catch {
        $existingToken = ''
    }
}

$token = if ($RotateToken) {
    New-RandomBridgeToken
} elseif ($env:PRINT_MANAGEMENT_TOKEN) {
    $env:PRINT_MANAGEMENT_TOKEN
} elseif ($existingToken.Length -ge 32) {
    $existingToken
} else {
    New-RandomBridgeToken
}
if ($token.Length -lt 32) {
    throw 'PRINT_MANAGEMENT_TOKEN must contain a random secret of at least 32 characters.'
}

$listenHost = if ($ListenAddress -eq '::1') { '[::1]' } else { $ListenAddress }
$listenPrefix = "http://${listenHost}:$Port/"
$configuration = [ordered]@{
    listenPrefix = $listenPrefix
    token = $token
    allowedClients = @($AllowedClients)
    allowPrivateHttp = [bool]$AllowPrivateHttp
    firewallRuleName = $FirewallRuleName
}

if ($PSCmdlet.ShouldProcess($ConfigurationRoot, 'install the Fred printer-management bridge')) {
    New-Item -ItemType Directory -Path $ConfigurationRoot -Force | Out-Null
    Set-Acl -LiteralPath $ConfigurationRoot -AclObject (New-RestrictedDirectoryAcl)

    Copy-Item -LiteralPath $sourceScript -Destination $installedScript -Force
    Set-Acl -LiteralPath $installedScript -AclObject (New-RestrictedFileAcl)

    $temporaryConfig = Join-Path $ConfigurationRoot 'config.json.new'
    $json = ConvertTo-Json -InputObject $configuration -Depth 4
    [IO.File]::WriteAllText($temporaryConfig, $json, [Text.UTF8Encoding]::new($false))
    Set-Acl -LiteralPath $temporaryConfig -AclObject (New-RestrictedFileAcl)
    Move-Item -LiteralPath $temporaryConfig -Destination $configPath -Force
    Set-Acl -LiteralPath $configPath -AclObject (New-RestrictedFileAcl)

    Import-Module NetSecurity -ErrorAction Stop
    $existingRule = Get-NetFirewallRule -Name $FirewallRuleName -ErrorAction SilentlyContinue
    if ($isLoopback) {
        if ($existingRule) { $existingRule | Disable-NetFirewallRule | Out-Null }
    } elseif ($existingRule) {
        $existingRule | Set-NetFirewallRule -Enabled True -Direction Inbound -Action Allow -Profile Domain | Out-Null
        $existingRule | Get-NetFirewallPortFilter |
            Set-NetFirewallPortFilter -Protocol TCP -LocalPort $Port -RemotePort Any | Out-Null
        $existingRule | Get-NetFirewallAddressFilter |
            Set-NetFirewallAddressFilter -RemoteAddress $AllowedClients | Out-Null
    } else {
        $firewallParameters = @{
            Name = $FirewallRuleName
            DisplayName = 'SCCC Fred Printer Bridge'
            Description = 'Restricts Fred printer-management API access to approved application hosts.'
            Enabled = 'True'
            Direction = 'Inbound'
            Action = 'Allow'
            Profile = 'Domain'
            Protocol = 'TCP'
            LocalPort = $Port
            RemoteAddress = $AllowedClients
        }
        New-NetFirewallRule @firewallParameters | Out-Null
    }

    Import-Module ScheduledTasks -ErrorAction Stop
    $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "{0}" -ConfigurationPath "{1}"' -f $installedScript, $configPath
    $action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settingsParameters = @{
        AllowStartIfOnBatteries = $true
        DontStopIfGoingOnBatteries = $true
        ExecutionTimeLimit = [TimeSpan]::Zero
        RestartCount = 3
        RestartInterval = (New-TimeSpan -Minutes 1)
        MultipleInstances = 'IgnoreNew'
        StartWhenAvailable = $true
    }
    $settings = New-ScheduledTaskSettingsSet @settingsParameters
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $taskParameters = @{
        TaskName = $TaskName
        Action = $action
        Trigger = $trigger
        Principal = $principal
        Settings = $settings
        Description = 'Fixed-purpose Fred print queue bridge.'
        Force = $true
    }
    Register-ScheduledTask @taskParameters | Out-Null
    Start-ScheduledTask -TaskName $TaskName

    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(50)
    $catalogUri = "${listenPrefix}v1/printers/drivers"
    $headers = @{ Authorization = "Bearer $token" }
    do {
        try {
            $catalog = Invoke-RestMethod -Method Get -Uri $catalogUri -Headers $headers -TimeoutSec 35
            if ($catalog.printServer -eq 'prntsp2.sccc.edu' -and @($catalog.drivers).Count -gt 0) {
                $ready = $true
                break
            }
        } catch {
            # The task may still be starting. Never echo the authenticated request.
        }
        if ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 750 }
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $ready) {
        throw "'$TaskName' was registered but its authenticated driver endpoint did not become ready. Check Task Scheduler history and the bridge configuration."
    }

    Write-Host "Installed and started '$TaskName' with listener $listenPrefix" -ForegroundColor Green
    Write-Host "The bearer token is stored only in ACL-restricted $configPath." -ForegroundColor Yellow
    Write-Host 'Put that token in Fred''s PRINT_MANAGEMENT_TOKEN secret; do not add it to source control.' -ForegroundColor Yellow
}
