Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:AgentVersion = '1.1.1'
$script:MaximumTransferBytes = 32MB

function Get-DiagnosticsServerOrigin {
    param([Parameter(Mandatory = $true)][string]$ServerUrl)
    $uri = $null
    if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -cne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $uri.AbsolutePath -ne '/' -or [Uri]::CheckHostName($uri.DnsSafeHost) -ne [UriHostNameType]::Dns) {
        throw 'Diagnostics server must be an HTTPS DNS origin without a path, credentials, query, or fragment.'
    }
    return $uri.GetLeftPart([UriPartial]::Authority)
}

function Test-DiagnosticsProtectedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    # Both the file and its parent must reject writes/reads by ordinary users.
    # DPAPI LocalMachine protects the blob at rest; the ACL is the user boundary.
    foreach ($candidate in @($Path, (Split-Path -Parent $Path))) {
        $item = Get-Item -LiteralPath $candidate -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Diagnostics paths cannot be reparse points.' }
        $acl = Get-Acl -LiteralPath $candidate
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin @('S-1-5-18', 'S-1-5-32-544')) { throw 'Diagnostics configuration owner must be SYSTEM or Administrators.' }
        if (-not $acl.AreAccessRulesProtected) { throw 'Diagnostics configuration must have an explicit protected ACL.' }
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                $rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544')) {
                throw 'Diagnostics configuration permits a non-administrator principal.'
            }
        }
    }
}

function Set-DiagnosticsProtectedAcl {
    param([Parameter(Mandatory = $true)][string]$Path, [switch]$Directory)
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Diagnostics paths cannot be reparse points.' }
    if ($Directory) { $acl = New-Object Security.AccessControl.DirectorySecurity }
    else { $acl = New-Object Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true, $false)
    $administrators = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
    $acl.SetOwner($administrators)
    foreach ($sid in @($administrators, $system)) {
        if ($Directory) {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        } else { $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow') }
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Test-DiagnosticsParentPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Diagnostics parent must be a regular directory.' }
    $acl = Get-Acl -LiteralPath $Path
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-18', 'S-1-5-32-544')) { throw 'Diagnostics parent owner must be SYSTEM or Administrators.' }
    $writes = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $rule.IdentityReference.Value -notin @('S-1-5-18', 'S-1-5-32-544') -and ($rule.FileSystemRights -band $writes)) {
            throw 'Diagnostics parent is writable by another principal; request an IT-reviewed location without changing other SCCC application permissions.'
        }
    }
}

function Read-DiagnosticsConfig {
    param([Parameter(Mandatory = $true)][string]$Path)
    Test-DiagnosticsProtectedPath -Path $Path
    $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($config.schemaVersion -ne 1) { throw 'Unsupported diagnostics configuration version.' }
    $origin = Get-DiagnosticsServerOrigin -ServerUrl $config.serverUrl
    $deviceId = [Guid]::Parse($config.deviceId).ToString()
    if ($config.computerName -ine $env:COMPUTERNAME) { throw 'Diagnostics configuration belongs to a different computer.' }
    Add-Type -AssemblyName System.Security
    $clearBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        [Convert]::FromBase64String($config.protectedDeviceToken),
        [Text.Encoding]::UTF8.GetBytes('SCCC.Diagnostics.v1:' + $deviceId),
        [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { $token = [Text.Encoding]::UTF8.GetString($clearBytes) }
    finally { [Array]::Clear($clearBytes, 0, $clearBytes.Length) }
    if ($token -cnotmatch '^sccc-diag\.[A-Za-z0-9_-]{43}$') { throw 'Invalid independent diagnostics credential.' }
    $externalOrigin = ''
    $permitSustained = $false
    if ($config.PSObject.Properties['externalProbeOrigin'] -and $config.externalProbeOrigin) { $externalOrigin = Get-DiagnosticsServerOrigin -ServerUrl ([string]$config.externalProbeOrigin); if (-not ([Uri]$externalOrigin).IsDefaultPort) { throw 'External probe requires HTTPS port 443.' } }
    if ($config.PSObject.Properties['permitSustained']) { $permitSustained = $config.permitSustained -eq $true }
    return [pscustomobject]@{ ServerOrigin = $origin; DeviceId = $deviceId; DeviceToken = $token; Domain = [string]$config.domain; ExternalProbeOrigin = $externalOrigin; PermitSustained = $permitSustained }
}

function Test-DiagnosticsJob {
    param([Parameter(Mandatory = $true)]$Job, [Parameter(Mandatory = $true)][string]$DeviceId,
        [Parameter(Mandatory = $true)][string]$DeviceToken, [DateTimeOffset]$Now = [DateTimeOffset]::UtcNow,
        [string]$ExternalProbeOrigin = '', [bool]$PermitSustained = $false)
    $id = [Guid]::Empty
    if (-not [Guid]::TryParse([string]$Job.id, [ref]$id)) { throw 'Invalid diagnostics job identity.' }
    $expires = [DateTimeOffset]::Parse([string]$Job.expiresAt, [Globalization.CultureInfo]::InvariantCulture)
    if ($expires -le $Now -or $expires -gt $Now.AddMinutes(5)) { throw 'Diagnostics job expiry is outside the permitted window.' }
    $type = 'fred'
    if ($Job.PSObject.Properties['type']) { $type = [string]$Job.type }
    $external = $type -in @('external-quick', 'external-sustained')
    if ($type -notin @('fred', 'external-quick', 'external-sustained')) { throw 'Unknown diagnostics job type.' }
    $maximum = if ($external) { 1GB } else { $script:MaximumTransferBytes }
    foreach ($field in @('downloadBytes', 'uploadBytes')) {
        $value = 0L
        if (-not [long]::TryParse([string]$Job.$field, [ref]$value) -or $value -lt 0 -or $value -gt $maximum) {
            throw 'Diagnostics transfer exceeds the permitted byte budget.'
        }
    }
    $pingCount = 0
    if (-not [int]::TryParse([string]$Job.pingCount, [ref]$pingCount) -or $pingCount -lt 1 -or $pingCount -gt 10) {
        throw 'Diagnostics ping count is outside the permitted range.'
    }
    $canonical = '{0}|{1}|{2}|{3}|{4}|{5}' -f [string]$Job.id, $DeviceId, [string]$Job.expiresAt, [string]$Job.downloadBytes, [string]$Job.uploadBytes, [string]$Job.pingCount
    $targetOrigin = ''; $seconds = 30
    if ($external) {
        if (-not $ExternalProbeOrigin -or $Job.proofVersion -ne 2) { throw 'External probing is not configured for this device.' }
        $targetOrigin = Get-DiagnosticsServerOrigin -ServerUrl ([string]$Job.targetOrigin)
        if (-not ([Uri]$targetOrigin).IsDefaultPort) { throw 'External probe requires HTTPS port 443.' }
        if ($targetOrigin -cne $ExternalProbeOrigin -or [long]$Job.uploadBytes -ne 0 -or $pingCount -ne 1) { throw 'External target does not match the protected device configuration.' }
        $seconds = 0
        if (-not [int]::TryParse([string]$Job.timeoutSeconds, [ref]$seconds) -or $seconds -lt 1 -or
            ($type -eq 'external-quick' -and ($seconds -gt 30 -or [long]$Job.downloadBytes -ne 5MB)) -or
            ($type -eq 'external-sustained' -and (-not $PermitSustained -or $seconds -gt 180 -or [long]$Job.downloadBytes -lt 1))) { throw 'External job exceeds its local permission or limits.' }
        $canonical = 'v2|{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}' -f [string]$Job.id, $DeviceId, [string]$Job.expiresAt, $type, [string]$Job.targetOrigin, [string]$Job.downloadBytes, [string]$Job.uploadBytes, [string]$Job.pingCount, [string]$Job.timeoutSeconds
    }
    $proof = [string]$Job.proof
    if ($proof -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw 'Missing or invalid diagnostics job proof.' }
    $key = [Text.Encoding]::UTF8.GetBytes($DeviceToken)
    $hmac = New-Object Security.Cryptography.HMACSHA256(,$key)
    try {
        $expected = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).TrimEnd('=').Replace('+', '-').Replace('/', '_')
        # Equal-length, constant-work comparison supports .NET Framework 4.8.
        $difference = 0
        for ($index = 0; $index -lt $expected.Length; $index++) { $difference = $difference -bor ([int]$expected[$index] -bxor [int]$proof[$index]) }
        if ($difference -ne 0) { throw 'Diagnostics job proof does not match this device and byte budget.' }
    } finally { $hmac.Dispose(); [Array]::Clear($key, 0, $key.Length) }
    # No additional URLs or commands from the server are interpreted.
    return [pscustomobject]@{ Id = $id.ToString(); ExpiresAt = $expires; DownloadBytes = [long]$Job.downloadBytes; UploadBytes = [long]$Job.uploadBytes; PingCount = $pingCount; Type = $type; TargetOrigin = $targetOrigin; TimeoutSeconds = $seconds }
}

function Get-DiagnosticsMbps {
    param([long]$Bytes, [double]$ElapsedSeconds)
    if ($Bytes -lt 0 -or $ElapsedSeconds -le 0 -or [double]::IsNaN($ElapsedSeconds) -or [double]::IsInfinity($ElapsedSeconds)) { throw 'Invalid transfer measurement.' }
    return [Math]::Round(($Bytes * 8.0) / ($ElapsedSeconds * 1000000.0), 3)
}

function Get-DiagnosticsWifiAssociation {
    # Read-only Native Wi-Fi API. No localized netsh text, scans, association
    # changes, or permission bypass. Windows may deny BSSID without location
    # consent; in that case the existing private AP evidence remains necessary.
    try {
        if (-not ('ScccDiagnostics.NativeWifi' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
namespace ScccDiagnostics {
    public sealed class WifiAssociation {
        public string InterfaceGuid;
        public string Bssid;
        public string Ssid;
    }
    public static class NativeWifi {
        [DllImport("wlanapi.dll")] private static extern uint WlanOpenHandle(uint version, IntPtr reserved, out uint negotiatedVersion, out IntPtr handle);
        [DllImport("wlanapi.dll")] private static extern uint WlanCloseHandle(IntPtr handle, IntPtr reserved);
        [DllImport("wlanapi.dll")] private static extern uint WlanEnumInterfaces(IntPtr handle, IntPtr reserved, out IntPtr list);
        [DllImport("wlanapi.dll")] private static extern uint WlanQueryInterface(IntPtr handle, ref Guid id, uint opcode, IntPtr reserved, out uint size, out IntPtr data, out uint valueType);
        [DllImport("wlanapi.dll")] private static extern void WlanFreeMemory(IntPtr memory);
        public static WifiAssociation[] Current() {
            List<WifiAssociation> results = new List<WifiAssociation>();
            IntPtr handle = IntPtr.Zero, list = IntPtr.Zero;
            uint negotiated;
            if (WlanOpenHandle(2, IntPtr.Zero, out negotiated, out handle) != 0) return results.ToArray();
            try {
                if (WlanEnumInterfaces(handle, IntPtr.Zero, out list) != 0) return results.ToArray();
                // WLAN_INTERFACE_INFO_LIST: count/index then 532-byte records.
                int count = Marshal.ReadInt32(list);
                if (count < 0 || count > 64) return results.ToArray();
                for (int index = 0; index < count; index++) {
                    IntPtr info = IntPtr.Add(list, 8 + index * 532);
                    if (Marshal.ReadInt32(info, 528) != 1) continue; // connected
                    Guid id = (Guid)Marshal.PtrToStructure(info, typeof(Guid));
                    IntPtr data = IntPtr.Zero; uint size, valueType;
                    try {
                        // wlan_intf_opcode_current_connection = 7.
                        if (WlanQueryInterface(handle, ref id, 7, IntPtr.Zero, out size, out data, out valueType) != 0 || size < 604) continue;
                        int ssidLength = Marshal.ReadInt32(data, 520);
                        if (ssidLength < 0 || ssidLength > 32) continue;
                        byte[] ssid = new byte[ssidLength], mac = new byte[6];
                        Marshal.Copy(IntPtr.Add(data, 524), ssid, 0, ssidLength);
                        Marshal.Copy(IntPtr.Add(data, 560), mac, 0, 6);
                        if ((mac[0] & 1) != 0) continue;
                        string bssid = BitConverter.ToString(mac).Replace('-', ':').ToLowerInvariant();
                        if (bssid == "00:00:00:00:00:00") continue;
                        results.Add(new WifiAssociation { InterfaceGuid = id.ToString(), Bssid = bssid, Ssid = Encoding.UTF8.GetString(ssid) });
                    } finally { if (data != IntPtr.Zero) WlanFreeMemory(data); }
                }
            } finally { if (list != IntPtr.Zero) WlanFreeMemory(list); WlanCloseHandle(handle, IntPtr.Zero); }
            return results.ToArray();
        }
    }
}
'@
        }
        return @([ScccDiagnostics.NativeWifi]::Current())
    } catch { return @() }
}

function Get-DiagnosticsPresence {
    param([Parameter(Mandatory = $true)]$Config)
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    if (-not $computer.PartOfDomain -or $computer.Domain -ine $Config.Domain) { throw 'Computer is no longer joined to the provisioned AD domain.' }
    $adapters = @(Get-NetAdapter -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' -and $_.MacAddress } | Sort-Object ifIndex | Select-Object -First 16)
    $wifi = @(Get-DiagnosticsWifiAssociation)
    $interfaces = @()
    foreach ($adapter in $adapters) {
        try { $ip = Get-NetIPConfiguration -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue }
        catch {
            if ($_.FullyQualifiedErrorId -in @('CmdletizationQuery_NotFound_InterfaceIndex,Get-NetIPConfiguration', 'CmdletizationQuery_NotFound_InterfaceIndex,Get-NetIPInterface')) { continue }
            throw
        }
        $addresses = @()
        $gateway = @()
        if ($ip) {
            $addresses = @(@($ip.IPv4Address) + @($ip.IPv6Address) | Where-Object { $_ } | ForEach-Object { ([string]$_.IPAddress -split '%')[0] } | Where-Object { $_ } | Select-Object -Unique -First 16)
            $gateway = @($ip.IPv4DefaultGateway | Where-Object { $_ } | ForEach-Object { $_.NextHop } | Select-Object -First 1)
        }
        $kind = 'other'
        if ([int]$adapter.NdisPhysicalMedium -in @(1, 9)) { $kind = 'wifi' }
        elseif ([int]$adapter.NdisPhysicalMedium -eq 14 -or [int]$adapter.MediaType -eq 0) { $kind = 'ethernet' }
        $entry = @{ mac = ($adapter.MacAddress -replace '-', ':').ToLowerInvariant(); ipAddresses = $addresses; kind = $kind }
        if ($gateway.Count -gt 0) { $entry.gateway = ([string]$gateway[0] -split '%')[0] }
        if ($adapter.ReceiveLinkSpeed -gt 0) { $entry.linkMbps = [Math]::Round($adapter.ReceiveLinkSpeed / 1000000.0, 3) }
        if ($kind -eq 'wifi') {
            $association = @($wifi | Where-Object { $_.InterfaceGuid -ieq ([Guid]$adapter.InterfaceGuid).ToString() } | Select-Object -First 1)
            if ($association.Count -gt 0) {
                $entry.bssid = [string]$association[0].Bssid
                if ($association[0].Ssid) { $entry.ssid = [string]$association[0].Ssid }
            }
        }
        $interfaces += $entry
    }
    $presence = @{
        deviceId = $Config.DeviceId; computerName = [string]$computer.Name; adDomain = [string]$computer.Domain
        adJoined = [bool]$computer.PartOfDomain; uptimeSeconds = [long]([DateTime]::Now - $os.LastBootUpTime).TotalSeconds
        agentVersion = $script:AgentVersion; interfaces = $interfaces
    }
    if ($computer.UserName) { $presence.loggedOnUser = [string]$computer.UserName }
    if ($Config.PSObject.Properties['ExternalProbeOrigin'] -and $Config.ExternalProbeOrigin) { $presence.capabilities = @('external-probe-v2') }
    return $presence
}

function New-DiagnosticsHttpClient {
    param([Parameter(Mandatory = $true)]$Config)
    Add-Type -AssemblyName System.Net.Http
    # The platform validates the certificate chain and hostname. Never install a
    # callback that accepts arbitrary certificates, or follow redirects with a bearer.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $handler = New-Object Net.Http.HttpClientHandler
    $handler.AllowAutoRedirect = $false
    $handler.UseDefaultCredentials = $false
    $client = New-Object Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(30)
    $client.MaxResponseContentBufferSize = 65536
    $client.DefaultRequestHeaders.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Config.DeviceToken)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('SCCC-Diagnostics/' + $script:AgentVersion)
    return $client
}

function Invoke-DiagnosticsJson {
    param($Client, [string]$Origin, [string]$Path, $Body)
    $content = New-Object Net.Http.StringContent(($Body | ConvertTo-Json -Depth 8 -Compress), [Text.Encoding]::UTF8, 'application/json')
    $response = $null
    try {
        $response = $Client.PostAsync(($Origin + '/api/building-diagnostics' + $Path), $content).GetAwaiter().GetResult()
        [void]$response.EnsureSuccessStatusCode()
        if ($response.Content.Headers.ContentLength -gt 65536) { throw 'Diagnostics response exceeds the permitted size.' }
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($text.Length -gt 65536) { throw 'Diagnostics response exceeds the permitted size.' }
        if ($text) { return $text | ConvertFrom-Json }
    } finally { if ($response) { $response.Dispose() }; $content.Dispose() }
}

function Invoke-DiagnosticsMeasurement {
    param($Client, [string]$Origin, [string]$DeviceId, [string]$DeviceToken, $Job, [string]$ExternalProbeOrigin = '', [bool]$PermitSustained = $false)
    $validated = Test-DiagnosticsJob -Job $Job -DeviceId $DeviceId -DeviceToken $DeviceToken -ExternalProbeOrigin $ExternalProbeOrigin -PermitSustained $PermitSustained
    if ($validated.Type -ne 'fred') { return Invoke-DiagnosticsExternalMeasurement -Client $Client -Origin $Origin -DeviceId $DeviceId -Validated $validated }
    $prefix = $Origin + '/api/building-diagnostics/agent/'
    $result = @{ deviceId = $DeviceId; jobId = $validated.Id; downloadBytes = 0L; uploadBytes = 0L }
    $times = @()
    $failures = 0
    for ($i = 0; $i -lt $validated.PingCount; $i++) {
        if ([DateTimeOffset]::UtcNow -ge $validated.ExpiresAt) { throw 'Diagnostics job expired.' }
        $response = $null; $request = $null; $cts = New-Object Threading.CancellationTokenSource
        $cts.CancelAfter(5000)
        $watch = [Diagnostics.Stopwatch]::StartNew()
        try {
            $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, ($prefix + 'ping/' + $validated.Id))
            $response = $Client.SendAsync($request, $cts.Token).GetAwaiter().GetResult()
            [void]$response.EnsureSuccessStatusCode()
            $watch.Stop(); $times += $watch.Elapsed.TotalMilliseconds
        } catch { $failures++ }
        finally { if ($response) { $response.Dispose() }; if ($request) { $request.Dispose() }; $cts.Dispose() }
    }
    $result.requestLossPercent = [Math]::Round(100.0 * $failures / $validated.PingCount, 2)
    if ($times.Count -gt 0) { $result.latencyMs = [Math]::Round(($times | Measure-Object -Average).Average, 3) }
    else { $result.error = 'https_probes_failed' }
    try {
        if ([DateTimeOffset]::UtcNow -ge $validated.ExpiresAt) { throw 'Diagnostics job expired.' }
        if ($validated.DownloadBytes -gt 0) {
            $response = $null; $stream = $null; $cts = New-Object Threading.CancellationTokenSource
            $cts.CancelAfter(30000)
            $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, ($prefix + 'download/' + $validated.Id))
            $watch = [Diagnostics.Stopwatch]::StartNew()
            try {
                $response = $Client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cts.Token).GetAwaiter().GetResult()
                [void]$response.EnsureSuccessStatusCode()
                if ($response.Content.Headers.ContentLength -ne $validated.DownloadBytes) { throw 'Unexpected diagnostics download size.' }
                $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                $buffer = New-Object byte[] 65536
                $total = 0L
                while (($read = $stream.ReadAsync($buffer, 0, $buffer.Length, $cts.Token).GetAwaiter().GetResult()) -gt 0) {
                    $total += $read
                    if ($total -gt $validated.DownloadBytes) { throw 'Diagnostics download exceeded its byte budget.' }
                }
                $watch.Stop()
                if ($total -ne $validated.DownloadBytes) { throw 'Incomplete diagnostics download.' }
                $result.downloadBytes = $total
                $result.downloadMbps = Get-DiagnosticsMbps -Bytes $total -ElapsedSeconds $watch.Elapsed.TotalSeconds
            } finally { if ($stream) { $stream.Dispose() }; if ($response) { $response.Dispose() }; $request.Dispose(); $cts.Dispose() }
        }
        if ([DateTimeOffset]::UtcNow -ge $validated.ExpiresAt) { throw 'Diagnostics job expired.' }
        if ($validated.UploadBytes -gt 0) {
            $buffer = New-Object byte[] ([int]$validated.UploadBytes)
            $random = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $random.GetBytes($buffer) } finally { $random.Dispose() }
            $content = New-Object Net.Http.ByteArrayContent(,$buffer)
            $content.Headers.ContentType = New-Object Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
            $content.Headers.ContentLength = $validated.UploadBytes
            $response = $null
            $watch = [Diagnostics.Stopwatch]::StartNew()
            try {
                $response = $Client.PutAsync(($prefix + 'upload/' + $validated.Id), $content).GetAwaiter().GetResult()
                [void]$response.EnsureSuccessStatusCode()
                $watch.Stop()
                $receiptText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if ($receiptText.Length -gt 4096) { throw 'Oversized upload receipt.' }
                $receipt = $receiptText | ConvertFrom-Json
                if ([long]$receipt.bytes -ne $validated.UploadBytes) { throw 'Diagnostics upload byte receipt does not match.' }
                $result.uploadBytes = $validated.UploadBytes
                $result.uploadMbps = Get-DiagnosticsMbps -Bytes $validated.UploadBytes -ElapsedSeconds $watch.Elapsed.TotalSeconds
            } finally { if ($response) { $response.Dispose() }; $content.Dispose(); [Array]::Clear($buffer, 0, $buffer.Length) }
        }
    } catch {
        # Deliberately do not send exception text: it can contain URLs, headers,
        # or local details. The central server already has the job/receipt data.
        $result.error = 'bounded_measurement_failed'
    }
    return $result
}

function Import-DiagnosticsExternalEngine {
    # Production never compiles or executes an unsigned .cs file. The release
    # package includes a signed DLL, verified again before loading.
    if ('Sccc.Diagnostics.ExternalProbe' -as [type]) { return }
    $path = Join-Path $PSScriptRoot 'ExternalProbe.dll'
    Test-DiagnosticsProtectedPath -Path $path
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate -or
        $signature.SignerCertificate.Subject -cne 'CN=Seward County Community College, O=Seward County Community College, L=Liberal, S=Kansas, C=US') { throw 'External probe engine must have a valid timestamped SCCC signature.' }
    [void][Reflection.Assembly]::LoadFrom($path)
}

function Get-DiagnosticsActiveAdapter {
    param([string]$LocalAddress)
    if (-not $LocalAddress) { return $null }
    try {
        $address = Get-NetIPAddress -IPAddress $LocalAddress -ErrorAction Stop | Select-Object -First 1
        $adapter = Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { $_.ifIndex -eq $address.InterfaceIndex } | Select-Object -First 1
        if (-not $adapter) { return $null }
        $ip = Get-NetIPConfiguration -InterfaceIndex $address.InterfaceIndex -ErrorAction SilentlyContinue
        $kind = 'other'
        if ([int]$adapter.NdisPhysicalMedium -in @(1,9)) { $kind = 'wifi' }
        elseif ([int]$adapter.NdisPhysicalMedium -eq 14 -or [int]$adapter.MediaType -eq 0) { $kind = 'ethernet' }
        $result = @{ interfaceAlias = ([string]$adapter.Name).Substring(0, [Math]::Min(120, ([string]$adapter.Name).Length)); kind = $kind; localIp = $LocalAddress; subnetPrefixLength = [int]$address.PrefixLength }
        $mac = ($adapter.MacAddress -replace '-', ':').ToLowerInvariant()
        if ($mac -match '^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$') { $result.mac = $mac }
        $gateways = @()
        if ($ip) { $gateways = @(if ($LocalAddress.Contains(':')) { @($ip.IPv6DefaultGateway) } else { @($ip.IPv4DefaultGateway) }) }
        if ($ip -and $gateways.Count -gt 0 -and $gateways[0]) { $result.gateway = ([string]$gateways[0].NextHop -split '%')[0] }
        if ($kind -eq 'wifi') {
            $association = @(Get-DiagnosticsWifiAssociation | Where-Object { $_.InterfaceGuid -ieq ([Guid]$adapter.InterfaceGuid).ToString() } | Select-Object -First 1)
            if ($association.Count -gt 0) { $result.bssid = [string]$association[0].Bssid; if ($association[0].Ssid) { $result.ssid = [string]$association[0].Ssid } }
        }
        return $result
    } catch { return $null }
}

function Invoke-DiagnosticsExternalMeasurement {
    param($Client, [string]$Origin, [string]$DeviceId, $Validated)
    Import-DiagnosticsExternalEngine
    $cancel = New-Object Threading.CancellationTokenSource
    $statusResponse = $null
    $cancelReason = 'cancelled'
    try {
        $task = [Sccc.Diagnostics.ExternalProbe]::Start($Validated.TargetOrigin, $Validated.Type, $Validated.DownloadBytes, $Validated.TimeoutSeconds, $cancel.Token)
        while (-not $task.Wait(2000)) {
            if ([DateTimeOffset]::UtcNow -ge $Validated.ExpiresAt) { $cancelReason = 'job_expired'; $cancel.Cancel(); break }
            # Only the Fred client has a bearer. The external TLS engine has no
            # credential parameter and connects directly to the pinned target.
            $statusRequest = $null; $statusTimeout = $null; $statusStream = $null
            try {
                $statusTimeout = New-Object Threading.CancellationTokenSource
                $statusTimeout.CancelAfter(5000)
                $statusRequest = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, ($Origin + '/api/building-diagnostics/agent/jobs/' + $Validated.Id))
                $statusResponse = $Client.SendAsync($statusRequest, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $statusTimeout.Token).GetAwaiter().GetResult()
                [void]$statusResponse.EnsureSuccessStatusCode()
                if ($statusResponse.Content.Headers.ContentLength -gt 4096) { throw 'Oversized job status.' }
                $statusStream = $statusResponse.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                $statusBuffer = New-Object byte[] 4097
                $statusBytes = 0
                while (($read = $statusStream.ReadAsync($statusBuffer, $statusBytes, (4097 - $statusBytes), $statusTimeout.Token).GetAwaiter().GetResult()) -gt 0) {
                    $statusBytes += $read
                    if ($statusBytes -gt 4096) { throw 'Oversized job status.' }
                }
                $statusText = [Text.Encoding]::UTF8.GetString($statusBuffer, 0, $statusBytes)
                $status = $statusText | ConvertFrom-Json
                if ($status.status -ne 'running') { $cancel.Cancel(); break }
            } catch { $cancelReason = 'control_plane_unavailable'; $cancel.Cancel(); break }
            finally { if ($statusStream) { $statusStream.Dispose() }; if ($statusResponse) { $statusResponse.Dispose(); $statusResponse = $null }; if ($statusRequest) { $statusRequest.Dispose() }; if ($statusTimeout) { $statusTimeout.Dispose() } }
        }
        $measurement = $task.GetAwaiter().GetResult()
        if ($measurement.failure -eq 'cancelled') { $measurement.failure = $cancelReason }
        $external = @{}
        foreach ($field in $measurement.GetType().GetFields()) {
            $value = $field.GetValue($measurement)
            if ($null -ne $value -and -not ($value -is [string] -and $value.Length -eq 0)) { $external[$field.Name] = $value }
        }
        $adapter = Get-DiagnosticsActiveAdapter -LocalAddress $measurement.localAddress
        if ($adapter) { $external.activeAdapter = $adapter }
        $result = @{ deviceId = $DeviceId; jobId = $Validated.Id; external = $external }
        if ($measurement.failure) { $result.error = [string]$measurement.failure }
        return $result
    } finally { $cancel.Cancel(); $cancel.Dispose(); if ($statusResponse) { $statusResponse.Dispose() } }
}

Export-ModuleMember -Function Get-DiagnosticsServerOrigin, Test-DiagnosticsProtectedPath, Set-DiagnosticsProtectedAcl, Test-DiagnosticsParentPath, Read-DiagnosticsConfig, Test-DiagnosticsJob, Get-DiagnosticsMbps, Get-DiagnosticsPresence, New-DiagnosticsHttpClient, Invoke-DiagnosticsJson, Invoke-DiagnosticsMeasurement
