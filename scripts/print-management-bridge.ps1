[CmdletBinding()]
param(
    [string]$ConfigurationPath = 'C:\ProgramData\SCCC\FredPrinterBridge\config.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Security boundary: neither Fred nor callers may select another server.
$PrintServer = 'prntsp2.sccc.edu'
if ($env:COMPUTERNAME -ine 'PRNTSP2') {
    throw 'This fixed-purpose bridge may run only on the PRNTSP2 print server.'
}

function Assert-RestrictedConfigurationAcl {
    param([Parameter(Mandatory)][string]$Path)

    $allowedSids = @('S-1-5-18', 'S-1-5-32-544') # SYSTEM and local Administrators
    $acl = Get-Acl -LiteralPath $Path
    foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
        try {
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        } catch {
            throw "Cannot validate access to printer bridge configuration '$Path'."
        }
        if ($sid -notin $allowedSids) {
            throw "Printer bridge configuration '$Path' is readable by an unauthorized identity. Re-run the bridge installer to repair its ACL."
        }
    }
}

$configuration = $null
if (Test-Path -LiteralPath $ConfigurationPath -PathType Leaf) {
    Assert-RestrictedConfigurationAcl -Path $ConfigurationPath
    $configuration = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json -ErrorAction Stop
    $allowedConfigurationProperties = @(
        'listenPrefix', 'token', 'allowedClients', 'allowPrivateHttp', 'firewallRuleName'
    )
    foreach ($property in @($configuration.PSObject.Properties.Name)) {
        if ($property -notin $allowedConfigurationProperties) {
            throw "Unsupported printer bridge configuration property: $property"
        }
    }
}

function Get-ConfigurationValue {
    param([Parameter(Mandatory)][string]$Name, $DefaultValue = $null)
    if ($null -ne $configuration -and $configuration.PSObject.Properties[$Name]) {
        return $configuration.$Name
    }
    return $DefaultValue
}

$ListenPrefix = if ($env:PRINT_MANAGEMENT_LISTEN_PREFIX) {
    $env:PRINT_MANAGEMENT_LISTEN_PREFIX.Trim()
} else {
    [string](Get-ConfigurationValue -Name 'listenPrefix' -DefaultValue 'http://127.0.0.1:9130/')
}
$Token = if ($env:PRINT_MANAGEMENT_TOKEN) {
    $env:PRINT_MANAGEMENT_TOKEN
} else {
    [string](Get-ConfigurationValue -Name 'token' -DefaultValue '')
}
$configuredClients = if ($env:PRINT_MANAGEMENT_ALLOWED_CLIENTS) {
    @($env:PRINT_MANAGEMENT_ALLOWED_CLIENTS -split ',')
} else {
    @((Get-ConfigurationValue -Name 'allowedClients' -DefaultValue @('127.0.0.1', '::1')))
}
$AllowedClients = @($configuredClients | ForEach-Object { [string]$_ } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$privateHttpSetting = if ($null -ne $env:PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP) {
    $env:PRINT_MANAGEMENT_ALLOW_PRIVATE_HTTP
} else {
    Get-ConfigurationValue -Name 'allowPrivateHttp' -DefaultValue $false
}
$AllowPrivateHttp = [string]$privateHttpSetting -match '^(?i:true|1)$'
$FirewallRuleName = if ($env:PRINT_MANAGEMENT_FIREWALL_RULE_NAME) {
    $env:PRINT_MANAGEMENT_FIREWALL_RULE_NAME.Trim()
} else {
    [string](Get-ConfigurationValue -Name 'firewallRuleName' -DefaultValue 'SCCC-Fred-Printer-Bridge')
}

if ([string]::IsNullOrWhiteSpace($Token) -or $Token.Length -lt 32) {
    throw 'PRINT_MANAGEMENT_TOKEN must contain a random secret of at least 32 characters.'
}
if (-not $ListenPrefix.EndsWith('/')) { $ListenPrefix += '/' }

$listenUri = [Uri]$ListenPrefix
if ($listenUri.Scheme -notin @('http', 'https')) {
    throw 'PRINT_MANAGEMENT_LISTEN_PREFIX must use http or https.'
}
if ($listenUri.AbsolutePath -ne '/' -or $listenUri.Query -or $listenUri.Fragment -or $listenUri.UserInfo) {
    throw 'PRINT_MANAGEMENT_LISTEN_PREFIX must be a root URL without credentials, query, or fragment.'
}
$loopbackNames = @('127.0.0.1', 'localhost', '[::1]', '::1')
if ($AllowedClients.Count -eq 0) {
    throw 'PRINT_MANAGEMENT_ALLOWED_CLIENTS must contain at least one address.'
}
$validatedClients = foreach ($client in $AllowedClients) {
    $parsedClient = $null
    if (-not [Net.IPAddress]::TryParse($client, [ref]$parsedClient) -or
        $parsedClient.Equals([Net.IPAddress]::Any) -or
        $parsedClient.Equals([Net.IPAddress]::IPv6Any)) {
        throw "Invalid allowed client address: $client"
    }
    if ($parsedClient.IsIPv4MappedToIPv6) { $parsedClient = $parsedClient.MapToIPv4() }
    $parsedClient.ToString()
}
$AllowedClients = @($validatedClients | Sort-Object -Unique)

$isLoopbackListener = $listenUri.Host -in $loopbackNames
$fixedPrivateHosts = @('10.0.0.30', 'prntsp2.sccc.edu')
if (-not $isLoopbackListener -and $listenUri.Host.ToLowerInvariant() -notin $fixedPrivateHosts) {
    throw 'A non-loopback listener may bind only to 10.0.0.30 or prntsp2.sccc.edu.'
}
if ($listenUri.Scheme -eq 'http' -and -not $isLoopbackListener) {
    if (-not $AllowPrivateHttp) {
        throw 'Plain HTTP is disabled. It may be enabled explicitly only for 10.0.0.30 or prntsp2.sccc.edu.'
    }
}
if (-not $isLoopbackListener -and
    -not $env:PRINT_MANAGEMENT_ALLOWED_CLIENTS -and
    -not ($null -ne $configuration -and $configuration.PSObject.Properties['allowedClients'])) {
    throw 'A non-loopback listener requires an explicit allowedClients configuration.'
}

function Assert-RestrictedFirewallRule {
    param(
        [Parameter(Mandatory)][string]$RuleName,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)][string[]]$Clients
    )

    Import-Module NetSecurity -ErrorAction Stop
    $rule = Get-NetFirewallRule -Name $RuleName -ErrorAction Stop
    if ($rule.Enabled -ne 'True' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow') {
        throw "Windows Firewall rule '$RuleName' must be enabled, inbound, and allow traffic."
    }
    $portFilters = @($rule | Get-NetFirewallPortFilter)
    if (-not ($portFilters | Where-Object {
        [string]$_.Protocol -in @('TCP', '6') -and [string]$_.LocalPort -eq [string]$Port
    })) {
        throw "Windows Firewall rule '$RuleName' must allow TCP/$Port only."
    }
    $remoteAddresses = @($rule | Get-NetFirewallAddressFilter |
        ForEach-Object { @($_.RemoteAddress) } |
        ForEach-Object { [string]$_ })
    if ($remoteAddresses.Count -eq 0 -or $remoteAddresses -contains 'Any' -or $remoteAddresses -contains '*') {
        throw "Windows Firewall rule '$RuleName' must restrict remote addresses."
    }
    foreach ($client in $Clients) {
        if ($client -notin $remoteAddresses) {
            throw "Windows Firewall rule '$RuleName' does not allow configured client '$client'."
        }
    }
}

if (-not $isLoopbackListener) {
    Assert-RestrictedFirewallRule -RuleName $FirewallRuleName -Port $listenUri.Port -Clients $AllowedClients
}

Import-Module PrintManagement -ErrorAction Stop

function Write-JsonResponse {
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][int]$StatusCode,
        [Parameter(Mandatory)]$Body
    )

    $json = ConvertTo-Json -InputObject $Body -Depth 6 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.Headers['Cache-Control'] = 'no-store'
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Get-NormalizedRemoteAddress {
    param([Parameter(Mandatory)]$Context)
    $address = $Context.Request.RemoteEndPoint.Address
    if ($address.IsIPv4MappedToIPv6) { $address = $address.MapToIPv4() }
    return $address.ToString()
}

function Test-FixedTimeToken {
    param(
        [Parameter(Mandatory)][string]$Provided,
        [Parameter(Mandatory)][string]$Expected
    )

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $left = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Provided))
        $right = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Expected))
        $difference = 0
        for ($index = 0; $index -lt $left.Length; $index++) {
            $difference = $difference -bor ($left[$index] -bxor $right[$index])
        }
        return $difference -eq 0
    } finally {
        $sha.Dispose()
    }
}

function Read-BoundedJsonBody {
    param(
        [Parameter(Mandatory)]$Request,
        [int]$MaximumBytes = 16384
    )

    if ($Request.ContentLength64 -gt $MaximumBytes) {
        throw 'Request body exceeds 16384 bytes.'
    }
    $memory = [IO.MemoryStream]::new()
    try {
        $buffer = New-Object byte[] 4096
        $total = 0
        while (($read = $Request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $read
            if ($total -gt $MaximumBytes) { throw 'Request body exceeds 16384 bytes.' }
            $memory.Write($buffer, 0, $read)
        }
        $text = [Text.Encoding]::UTF8.GetString($memory.ToArray())
        if ([string]::IsNullOrWhiteSpace($text)) { throw 'A JSON request body is required.' }
        return ConvertFrom-Json -InputObject $text -ErrorAction Stop
    } finally {
        $memory.Dispose()
    }
}

function Get-CleanRequiredText {
    param($Value, [string]$Label, [int]$MaximumLength)
    if ($Value -isnot [string]) { throw "$Label must be text." }
    $clean = $Value.Trim()
    if (-not $clean) { throw "$Label is required." }
    if ($clean.Length -gt $MaximumLength) { throw "$Label must be $MaximumLength characters or fewer." }
    if ($clean -match '[\x00-\x1f\x7f]') { throw "$Label contains unsupported control characters." }
    return $clean
}

function Get-CleanOptionalText {
    param($Value, [string]$Label, [int]$MaximumLength)
    if ($null -eq $Value) { return '' }
    if ($Value -isnot [string]) { throw "$Label must be text." }
    $clean = $Value.Trim()
    if ($clean.Length -gt $MaximumLength) { throw "$Label must be $MaximumLength characters or fewer." }
    if ($clean -match '[\x00-\x1f\x7f]') { throw "$Label contains unsupported control characters." }
    return $clean
}

function Test-IPv4Address {
    param([Parameter(Mandatory)][string]$Value)
    $parts = $Value -split '\.'
    if ($parts.Count -ne 4) { return $false }
    foreach ($part in $parts) {
        $number = 0
        if ($part -notmatch '^\d{1,3}$' -or -not [int]::TryParse($part, [ref]$number) -or $number -gt 255) {
            return $false
        }
    }
    return $true
}

function Test-PrivateIPv4Address {
    param([Parameter(Mandatory)][string]$Value)
    if (-not (Test-IPv4Address -Value $Value)) { return $false }
    $parts = @($Value -split '\.' | ForEach-Object { [int]$_ })
    return $parts[0] -eq 10 -or
        ($parts[0] -eq 172 -and $parts[1] -ge 16 -and $parts[1] -le 31) -or
        ($parts[0] -eq 192 -and $parts[1] -eq 168)
}

function Get-SafeShareName {
    param([Parameter(Mandatory)][string]$PrinterName)

    $safe = $PrinterName.Normalize([Text.NormalizationForm]::FormKC)
    $safe = $safe -replace '[\\/\[\]:\|<>\+=;,\?\*"\x00-\x1f\x7f]', '-'
    $safe = $safe -replace '\s+', ' '
    $safe = $safe -replace '-+', '-'
    $safe = $safe.Trim().Trim([char[]]@('.', ' '))
    if ($safe.Length -gt 80) { $safe = $safe.Substring(0, 80).Trim().TrimEnd('.', ' ') }
    $reservedShareName = '^(?i:ADMIN\$|IPC\$|PRINT\$|CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$'
    if (-not $safe -or
        $safe -notmatch '[\p{L}\p{N}]' -or
        $safe.EndsWith('$') -or
        $safe -match $reservedShareName) {
        throw 'Printer name does not produce a valid Windows share name.'
    }
    return $safe
}

function ConvertTo-InstallRequest {
    param([Parameter(Mandatory)]$Body)

    $allowedProperties = @('name', 'ip', 'driver', 'location', 'comment', 'shareName')
    $properties = @($Body.PSObject.Properties.Name)
    foreach ($property in $properties) {
        if ($property -notin $allowedProperties) { throw "Unsupported request property: $property" }
    }
    foreach ($required in @('name', 'ip', 'driver', 'shareName')) {
        if ($required -notin $properties) { throw "$required is required." }
    }

    $name = Get-CleanRequiredText -Value $Body.name -Label 'Printer name' -MaximumLength 120
    if ($name -match '[\\\*\?\[\]]') {
        throw 'Printer name cannot contain a backslash or wildcard characters.'
    }
    $ip = Get-CleanRequiredText -Value $Body.ip -Label 'Printer IPv4 address' -MaximumLength 15
    if (-not (Test-IPv4Address -Value $ip)) { throw 'Enter a valid printer IPv4 address.' }
    if (-not (Test-PrivateIPv4Address -Value $ip)) {
        throw 'Printer IPv4 address must be an RFC1918 campus address.'
    }
    $driver = Get-CleanRequiredText -Value $Body.driver -Label 'Printer driver' -MaximumLength 240
    $locationValue = if ('location' -in $properties) { $Body.location } else { $null }
    $commentValue = if ('comment' -in $properties) { $Body.comment } else { $null }
    $location = Get-CleanOptionalText -Value $locationValue -Label 'Location' -MaximumLength 255
    $comment = Get-CleanOptionalText -Value $commentValue -Label 'Comment' -MaximumLength 1024
    $shareName = Get-CleanRequiredText -Value $Body.shareName -Label 'Share name' -MaximumLength 80
    $expectedShareName = Get-SafeShareName -PrinterName $name
    if ($shareName -cne $expectedShareName) { throw 'Share name does not match the validated printer name.' }

    return [pscustomobject]@{
        Name = $name
        IP = $ip
        Driver = $driver
        Location = $location
        Comment = $comment
        ShareName = $shareName
    }
}

$getDriversOperation = {
    param($Server)
    $phase = 'driver'
    try {
        Import-Module PrintManagement -ErrorAction Stop
        $drivers = @(Get-PrinterDriver -ErrorAction Stop |
            Select-Object -ExpandProperty Name |
            Where-Object { $_ } |
            Sort-Object -Unique)
        [pscustomobject]@{ Ok = $true; Drivers = $drivers }
    } catch {
        [pscustomobject]@{ Ok = $false; Phase = $phase; Message = $_.Exception.Message }
    }
}

$installOperation = {
    param($Server, $InputData)

    $phase = 'connect'
    $createdPort = $false
    $portName = ''
    try {
        Import-Module PrintManagement -ErrorAction Stop
        $null = @(Get-Printer -ErrorAction Stop).Count

        $phase = 'driver'
        $driver = @(Get-PrinterDriver -ErrorAction Stop |
            Where-Object { $_.Name -eq $InputData.Driver } |
            Select-Object -First 1)
        if (-not $driver) {
            throw "The exact driver '$($InputData.Driver)' is not registered on '$Server'. Refresh the driver list and select an installed driver."
        }

        # Prove that RAW printing is reachable before making any server change.
        $phase = 'reachability'
        $tcp = [Net.Sockets.TcpClient]::new()
        try {
            $connectTask = $tcp.ConnectAsync($InputData.IP, 9100)
            if (-not $connectTask.Wait(5000) -or -not $tcp.Connected) {
                throw "$($InputData.IP) did not accept TCP/9100 within 5 seconds. Verify the copier address, power, VLAN, and routing."
            }
        } catch {
            throw "$($InputData.IP) did not accept TCP/9100 within 5 seconds. Verify the copier address, power, VLAN, and routing."
        } finally {
            $tcp.Dispose()
        }

        $portName = "IP_$($InputData.IP)"
        $phase = 'port'
        $existingPort = Get-PrinterPort -Name $portName -ErrorAction SilentlyContinue
        if ($existingPort) {
            if ($existingPort.PSObject.Properties['PrinterHostAddress'] -and
                [string]$existingPort.PrinterHostAddress -ne $InputData.IP) {
                throw "Existing port '$portName' points to '$($existingPort.PrinterHostAddress)', not '$($InputData.IP)'. No change was made."
            }
            if ($existingPort.PSObject.Properties['PortNumber'] -and
                [int]$existingPort.PortNumber -ne 9100) {
                throw "Existing port '$portName' is not configured for RAW TCP/9100. No change was made."
            }
            if ($existingPort.PSObject.Properties['SNMPEnabled'] -and $existingPort.SNMPEnabled) {
                throw "Existing port '$portName' has SNMP enabled. Correct that port manually before retrying; Fred will not delete a port that another queue may use."
            }
        } else {
            # Omitting SNMP settings creates this Standard TCP/IP port with SNMP disabled.
            # A zero SNMP index is invalid and must never be passed to Add-PrinterPort.
            $portParameters = @{
                Name = $portName
                PrinterHostAddress = $InputData.IP
                PortNumber = 9100
                ErrorAction = 'Stop'
            }
            Add-PrinterPort @portParameters
            $createdPort = $true
        }

        $phase = 'queue'
        $shareConflict = @(Get-Printer -ErrorAction Stop | Where-Object {
            $_.ShareName -eq $InputData.ShareName -and $_.Name -ne $InputData.Name
        } | Select-Object -First 1)
        if ($shareConflict) {
            throw "Share name '$($InputData.ShareName)' is already used by queue '$($shareConflict.Name)'. No queue change was made."
        }

        $existingPrinter = Get-Printer -Name $InputData.Name -ErrorAction SilentlyContinue
        $created = -not [bool]$existingPrinter
        if ($existingPrinter) {
            $printerParameters = @{
                Name = $InputData.Name
                DriverName = $driver.Name
                PortName = $portName
                Location = $InputData.Location
                Comment = $InputData.Comment
                Shared = $true
                ShareName = $InputData.ShareName
                ErrorAction = 'Stop'
            }
            Set-Printer @printerParameters
        } else {
            $printerParameters = @{
                Name = $InputData.Name
                DriverName = $driver.Name
                PortName = $portName
                Location = $InputData.Location
                Comment = $InputData.Comment
                Shared = $true
                ShareName = $InputData.ShareName
                ErrorAction = 'Stop'
            }
            Add-Printer @printerParameters
        }

        $phase = 'verify'
        $installed = Get-Printer -Name $InputData.Name -ErrorAction Stop
        if ($installed.DriverName -ne $driver.Name -or
            $installed.PortName -ne $portName -or
            -not $installed.Shared -or
            $installed.ShareName -ne $InputData.ShareName -or
            [string]$installed.Location -ne [string]$InputData.Location -or
            [string]$installed.Comment -ne [string]$InputData.Comment) {
            throw 'Queue verification failed after configuration.'
        }

        [pscustomobject]@{
            Ok = $true
            Created = $created
            Printer = [pscustomobject]@{
                Name = [string]$installed.Name
                Driver = [string]$installed.DriverName
                PortName = [string]$installed.PortName
                ShareName = [string]$installed.ShareName
                UncPath = "\\$Server\$($installed.ShareName)"
                Location = [string]$installed.Location
                Comment = [string]$installed.Comment
            }
        }
    } catch {
        $failureMessage = $_.Exception.Message
        # A failed queue must not leave Fred's brand-new, unused port behind.
        # Never remove a pre-existing port or one referenced by any queue.
        if ($createdPort -and $portName) {
            try {
                $portUsers = @(Get-Printer -ErrorAction Stop | Where-Object { $_.PortName -eq $portName })
                if ($portUsers.Count -eq 0) {
                    Remove-PrinterPort -Name $portName -ErrorAction Stop
                }
            } catch {
                # Preserve the primary phase failure; cleanup remains best-effort.
            }
        }
        [pscustomobject]@{ Ok = $false; Phase = $phase; Message = $failureMessage }
    }
}

function Invoke-BoundedOperation {
    param(
        [Parameter(Mandatory)][scriptblock]$Operation,
        [Parameter(Mandatory)][object[]]$ArgumentList,
        [Parameter(Mandatory)][int]$TimeoutSeconds
    )

    $job = Start-Job -ScriptBlock $Operation -ArgumentList $ArgumentList
    try {
        if (-not (Wait-Job -Job $job -Timeout $TimeoutSeconds)) {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
            return [pscustomobject]@{
                Ok = $false
                Phase = 'operation'
                Message = "The print-server operation timed out after $TimeoutSeconds seconds."
            }
        }
        return Receive-Job -Job $job -ErrorAction Stop
    } finally {
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
}

function Get-PhaseCode {
    param([string]$Phase)
    switch ($Phase) {
        'connect' { return 'PRINT_SERVER_UNAVAILABLE' }
        'driver' { return 'PRINTER_DRIVER_ERROR' }
        'reachability' { return 'PRINTER_UNREACHABLE' }
        'port' { return 'PRINTER_PORT_ERROR' }
        'queue' { return 'PRINTER_QUEUE_ERROR' }
        'verify' { return 'PRINTER_VERIFICATION_ERROR' }
        default { return 'PRINT_OPERATION_FAILED' }
    }
}

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add($ListenPrefix)
$listener.Start()
Write-Host "Printer-management bridge listening on $ListenPrefix for $PrintServer" -ForegroundColor Green

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $remoteAddress = Get-NormalizedRemoteAddress -Context $context
            if ($remoteAddress -notin $AllowedClients) {
                Write-JsonResponse -Context $context -StatusCode 403 -Body @{
                    error = @{ code = 'CLIENT_NOT_ALLOWED'; message = 'Client address is not allowed.' }
                }
                continue
            }

            $authorization = [string]$context.Request.Headers['Authorization']
            $providedToken = if ($authorization -match '^Bearer\s+(.+)$') { $Matches[1] } else { '' }
            if (-not (Test-FixedTimeToken -Provided $providedToken -Expected $Token)) {
                Write-JsonResponse -Context $context -StatusCode 401 -Body @{
                    error = @{ code = 'UNAUTHORIZED'; message = 'A valid bridge token is required.' }
                }
                continue
            }

            $path = $context.Request.Url.AbsolutePath.TrimEnd('/')
            if ($context.Request.HttpMethod -eq 'GET' -and $path -eq '/v1/printers/drivers') {
                $result = Invoke-BoundedOperation -Operation $getDriversOperation -ArgumentList @($PrintServer) -TimeoutSeconds 30
                if (-not $result.Ok) {
                    Write-JsonResponse -Context $context -StatusCode 502 -Body @{
                        error = @{
                            code = Get-PhaseCode -Phase $result.Phase
                            phase = $result.Phase
                            message = [string]$result.Message
                        }
                    }
                    continue
                }
                Write-JsonResponse -Context $context -StatusCode 200 -Body @{
                    printServer = $PrintServer
                    drivers = @($result.Drivers)
                }
                continue
            }

            if ($context.Request.HttpMethod -eq 'POST' -and $path -eq '/v1/printers') {
                try {
                    $body = Read-BoundedJsonBody -Request $context.Request
                    $inputData = ConvertTo-InstallRequest -Body $body
                } catch {
                    Write-JsonResponse -Context $context -StatusCode 400 -Body @{
                        error = @{
                            code = 'INVALID_PRINTER_CONFIGURATION'
                            phase = 'validation'
                            message = $_.Exception.Message
                        }
                    }
                    continue
                }

                $operationParameters = @{
                    Operation = $installOperation
                    ArgumentList = @($PrintServer, $inputData)
                    TimeoutSeconds = 105
                }
                $result = Invoke-BoundedOperation @operationParameters
                if (-not $result.Ok) {
                    $status = if ($result.Phase -eq 'reachability') { 422 } else { 502 }
                    Write-JsonResponse -Context $context -StatusCode $status -Body @{
                        error = @{
                            code = Get-PhaseCode -Phase $result.Phase
                            phase = [string]$result.Phase
                            message = [string]$result.Message
                        }
                    }
                    continue
                }

                $status = if ($result.Created) { 201 } else { 200 }
                Write-Host "[$([DateTime]::UtcNow.ToString('o'))] $remoteAddress configured '$($result.Printer.Name)' on $PrintServer"
                Write-JsonResponse -Context $context -StatusCode $status -Body @{
                    created = [bool]$result.Created
                    printer = @{
                        name = $result.Printer.Name
                        driver = $result.Printer.Driver
                        portName = $result.Printer.PortName
                        shareName = $result.Printer.ShareName
                        uncPath = $result.Printer.UncPath
                        location = $result.Printer.Location
                        comment = $result.Printer.Comment
                    }
                }
                continue
            }

            Write-JsonResponse -Context $context -StatusCode 404 -Body @{
                error = @{ code = 'NOT_FOUND'; message = 'Not found.' }
            }
        } catch {
            if ($context.Response.OutputStream.CanWrite) {
                Write-JsonResponse -Context $context -StatusCode 500 -Body @{
                    error = @{ code = 'BRIDGE_ERROR'; phase = 'bridge'; message = 'The bridge failed unexpectedly.' }
                }
            }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
