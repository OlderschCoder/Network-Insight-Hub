#Requires -Version 5.1
# Dependency-free, offline tests. No scheduled task, AD query, or network call.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Sccc.Diagnostics.psm1') -Force
$script:Passed = 0
function Assert-Equal($Actual, $Expected, [string]$Name) {
    if ($Actual -cne $Expected) { throw ('FAIL: ' + $Name) }
    $script:Passed++
}
function Assert-Rejected([scriptblock]$Operation, [string]$Name) {
    $rejected = $false
    try { & $Operation | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw ('FAIL: expected rejection: ' + $Name) }
    $script:Passed++
}
foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in @('.ps1', '.psm1') }) {
    $tokens = $null; $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw ($file.Name + ': ' + ($errors.Message -join '; ')) }
    $script:Passed++
}
Assert-Equal (Get-DiagnosticsServerOrigin 'https://fred.example.edu/') 'https://fred.example.edu' 'HTTPS origin normalization'
foreach ($badOrigin in @('http://fred.example.edu', 'https://fred.example.edu/redirect', 'https://user:pass@fred.example.edu/', 'https://fred.example.edu/?secret=x', 'https://127.0.0.1/', 'file:///C:/temp', 'https://fred.example.edu/#x')) {
    Assert-Rejected { Get-DiagnosticsServerOrigin $badOrigin } 'Untrusted origin shape'
}
Assert-Equal (Get-DiagnosticsMbps -Bytes 1000000 -ElapsedSeconds 1) 8.0 'Decimal Mbps conversion'
Assert-Equal (Get-DiagnosticsMbps -Bytes 1000000 -ElapsedSeconds 0.5) 16.0 'Transfer elapsed time'
Assert-Rejected { Get-DiagnosticsMbps -Bytes 1 -ElapsedSeconds 0 } 'Zero time'
Assert-Rejected { Get-DiagnosticsMbps -Bytes -1 -ElapsedSeconds 1 } 'Negative byte count'
Assert-Rejected { Get-DiagnosticsMbps -Bytes 1 -ElapsedSeconds ([double]::NaN) } 'NaN time'
$now = [DateTimeOffset]::UtcNow
$deviceId = '0c578d5f-7181-4cc6-ad6a-599c9bcaab80'
$token = 'sccc-diag.' + ('Q' * 43)
function New-Job([long]$DownloadBytes = 1048576, [long]$UploadBytes = 1048576, [int]$PingCount = 3, [int]$ExpirySeconds = 120) {
    $job = [pscustomobject]@{ id = '2178e709-78e9-4892-aeae-e975b7ab9e83'; expiresAt = $now.AddSeconds($ExpirySeconds).ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); downloadBytes = $DownloadBytes; uploadBytes = $UploadBytes; pingCount = $PingCount; proof = '' }
    $canonical = '{0}|{1}|{2}|{3}|{4}|{5}' -f $job.id, $deviceId, $job.expiresAt, $job.downloadBytes, $job.uploadBytes, $job.pingCount
    $hmac = New-Object Security.Cryptography.HMACSHA256(,[Text.Encoding]::UTF8.GetBytes($token))
    try { $job.proof = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
    finally { $hmac.Dispose() }
    return $job
}
$job = New-Job
$validated = Test-DiagnosticsJob -Job $job -DeviceId $deviceId -DeviceToken $token -Now $now
Assert-Equal $validated.Id $job.id 'Device-bound job accepted'
Assert-Equal $validated.DownloadBytes 1048576 'Transfer budget retained'
Assert-Rejected { Test-DiagnosticsJob -Job $job -DeviceId ([Guid]::NewGuid().ToString()) -DeviceToken $token -Now $now } 'Cross-device replay'
Assert-Rejected { Test-DiagnosticsJob -Job $job -DeviceId $deviceId -DeviceToken ($token + 'X') -Now $now } 'Wrong credential'
Assert-Rejected { Test-DiagnosticsJob -Job (New-Job -DownloadBytes 33554433) -DeviceId $deviceId -DeviceToken $token -Now $now } 'Download over cap'
Assert-Rejected { Test-DiagnosticsJob -Job (New-Job -UploadBytes -1) -DeviceId $deviceId -DeviceToken $token -Now $now } 'Negative upload'
Assert-Rejected { Test-DiagnosticsJob -Job (New-Job -PingCount 11) -DeviceId $deviceId -DeviceToken $token -Now $now } 'Ping cap'
Assert-Rejected { Test-DiagnosticsJob -Job (New-Job -ExpirySeconds -1) -DeviceId $deviceId -DeviceToken $token -Now $now } 'Expired job'
Assert-Rejected { Test-DiagnosticsJob -Job (New-Job -ExpirySeconds 301) -DeviceId $deviceId -DeviceToken $token -Now $now } 'Long-lived job'
$changed = New-Job; $changed.uploadBytes = 2097152
Assert-Rejected { Test-DiagnosticsJob -Job $changed -DeviceId $deviceId -DeviceToken $token -Now $now } 'Tampered byte budget'
$changed = New-Job; $changed.proof = ''
Assert-Rejected { Test-DiagnosticsJob -Job $changed -DeviceId $deviceId -DeviceToken $token -Now $now } 'Missing proof'
$changed = New-Job; $changed.id = '../redirect'
Assert-Rejected { Test-DiagnosticsJob -Job $changed -DeviceId $deviceId -DeviceToken $token -Now $now } 'Path injection'

# Synthetic HTTPS responses exercise actual HttpClient stream/receipt handling;
# the handler never opens a socket or uses real credentials.
Add-Type -AssemblyName System.Net.Http
$offlineHandlerSource = @'
using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
public class ScccDiagnosticsOfflineHandler : HttpMessageHandler {
    public bool WrongReceipt;
    public bool WrongDownloadSize;
    public int PingFailures;
    public int Calls;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        Calls++;
        HttpResponseMessage response = new HttpResponseMessage(HttpStatusCode.OK);
        if (request.RequestUri.AbsolutePath.Contains("/download/")) {
            response.Content = new ByteArrayContent(new byte[WrongDownloadSize ? 15 : 16]);
        } else if (request.RequestUri.AbsolutePath.Contains("/upload/")) {
            long count = request.Content.Headers.ContentLength.Value;
            response.Content = new StringContent("{\"bytes\":" + (WrongReceipt ? 1 : count) + "}", Encoding.UTF8, "application/json");
        } else { response.Content = new StringContent("{}"); if (PingFailures > 0) { response.StatusCode = HttpStatusCode.ServiceUnavailable; PingFailures--; } }
        return Task.FromResult(response);
    }
}
'@
if ($PSVersionTable.PSEdition -eq 'Desktop') { Add-Type -ReferencedAssemblies 'System.Net.Http' -TypeDefinition $offlineHandlerSource }
else { Add-Type -TypeDefinition $offlineHandlerSource }
$handler = New-Object ScccDiagnosticsOfflineHandler
$client = New-Object Net.Http.HttpClient($handler)
try {
    $measurement = Invoke-DiagnosticsMeasurement -Client $client -Origin 'https://fred.example.edu' -DeviceId $deviceId -DeviceToken $token -Job (New-Job -DownloadBytes 16 -UploadBytes 16)
    Assert-Equal $measurement.downloadBytes 16L 'Measured download byte count'
    Assert-Equal $measurement.uploadBytes 16L 'Server upload receipt checked'
    Assert-Equal $measurement.requestLossPercent 0.0 'HTTP request loss'
    Assert-Equal $handler.Calls 5 'Only bounded ping and transfer requests'
    if ($measurement.ContainsKey('error')) { throw 'FAIL: synthetic transfer unexpectedly failed.' }
    $script:Passed++
    $handler.WrongReceipt = $true
    $measurement = Invoke-DiagnosticsMeasurement -Client $client -Origin 'https://fred.example.edu' -DeviceId $deviceId -DeviceToken $token -Job (New-Job -DownloadBytes 16 -UploadBytes 16)
    Assert-Equal $measurement.error 'bounded_measurement_failed' 'Wrong receipt rejected'
    Assert-Equal $measurement.uploadBytes 0L 'Failed upload is not reported as success'
    $handler.WrongReceipt = $false; $handler.WrongDownloadSize = $true
    $measurement = Invoke-DiagnosticsMeasurement -Client $client -Origin 'https://fred.example.edu' -DeviceId $deviceId -DeviceToken $token -Job (New-Job -DownloadBytes 16 -UploadBytes 16)
    Assert-Equal $measurement.error 'bounded_measurement_failed' 'Wrong download size rejected'
    Assert-Equal $measurement.downloadBytes 0L 'Failed download is not reported as success'
    $handler.WrongDownloadSize = $false; $handler.PingFailures = 1
    $measurement = Invoke-DiagnosticsMeasurement -Client $client -Origin 'https://fred.example.edu' -DeviceId $deviceId -DeviceToken $token -Job (New-Job -DownloadBytes 16 -UploadBytes 16)
    Assert-Equal $measurement.requestLossPercent 33.33 'Partial HTTP request failure is measured'
    Assert-Equal $measurement.uploadBytes 16L 'Partial probe loss can retain transfer evidence'
    $handler.PingFailures = 3
    $measurement = Invoke-DiagnosticsMeasurement -Client $client -Origin 'https://fred.example.edu' -DeviceId $deviceId -DeviceToken $token -Job (New-Job -DownloadBytes 16 -UploadBytes 16)
    Assert-Equal $measurement.requestLossPercent 100.0 'All probe requests failed'
    Assert-Equal $measurement.error 'https_probes_failed' 'All probe failures cannot become a successful latency result'
} finally { $client.Dispose() }
# Compile the read-only native query without loading wlanapi or querying Wi-Fi.
$nativeFunction = & (Get-Module Sccc.Diagnostics) { ${function:Get-DiagnosticsWifiAssociation}.ToString() }
$nativeSource = [regex]::Match($nativeFunction, "(?s)@'\r?\n(.*?)\r?\n'@").Groups[1].Value
if (-not $nativeSource) { throw 'Native Wi-Fi source could not be inspected.' }
Add-Type -TypeDefinition $nativeSource
$script:Passed++
# Exercise presence shape against in-memory cmdlet doubles, including an up
# adapter whose IP configuration is absent. No local machine/user is queried.
& (Get-Module Sccc.Diagnostics) {
    function script:Get-CimInstance {
        param([string]$ClassName)
        if ($ClassName -eq 'Win32_ComputerSystem') {
            return [pscustomobject]@{ Name = 'OFFLINE-PILOT'; PartOfDomain = $true; Domain = 'example.edu'; UserName = 'EXAMPLE\staff' }
        }
        return [pscustomobject]@{ LastBootUpTime = [DateTime]::Now.AddMinutes(-10) }
    }
    function script:Get-NetAdapter {
        @(
            [pscustomobject]@{ Status = 'Up'; MacAddress = '00-11-22-33-44-55'; ifIndex = 1; NdisPhysicalMedium = 14; MediaType = 0; ReceiveLinkSpeed = 1000000000 },
            [pscustomobject]@{ Status = 'Up'; MacAddress = '00-11-22-33-44-66'; ifIndex = 2; NdisPhysicalMedium = 14; MediaType = 0; ReceiveLinkSpeed = 100000000 }
        )
    }
    function script:Get-NetIPConfiguration {
        param([int]$InterfaceIndex)
        if ($InterfaceIndex -eq 1) {
            return [pscustomobject]@{ IPv4Address = @([pscustomobject]@{ IPAddress = '10.1.2.3' }); IPv6Address = @([pscustomobject]@{ IPAddress = 'fe80::1234%3' }); IPv4DefaultGateway = @([pscustomobject]@{ NextHop = '10.1.2.1' }) }
        }
        return $null
    }
    function script:Get-DiagnosticsWifiAssociation { return @() }
}
$presence = Get-DiagnosticsPresence -Config ([pscustomobject]@{ DeviceId = $deviceId; Domain = 'example.edu' })
Assert-Equal $presence.interfaces.Count 2 'Presence retains adapter without IP configuration'
Assert-Equal $presence.interfaces[0].mac '00:11:22:33:44:55' 'MAC normalization'
Assert-Equal $presence.interfaces[0].linkMbps 1000.0 'Negotiated link rate is separate metadata'
Assert-Equal $presence.interfaces[0].ipAddresses[1] 'fe80::1234' 'IPv6 zone removed from IP-only contract'
Assert-Equal $presence.loggedOnUser 'EXAMPLE\staff' 'Exact domain-qualified phone mapping identity'
Assert-Rejected { Get-DiagnosticsPresence -Config ([pscustomobject]@{ DeviceId = $deviceId; Domain = 'different.edu' }) } 'AD domain change stops check-in'
Write-Output ('PASS: {0} offline diagnostics assertions and script parses; no network or task activation.' -f $script:Passed)
