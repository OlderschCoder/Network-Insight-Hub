#Requires -Version 5.1
# Offline source compilation and synthetic streams only. No DNS, TCP or TLS call.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Sccc.Diagnostics.psm1') -Force
if (-not ('Sccc.Diagnostics.ExternalProbe' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'ExternalProbe.cs') }
$script:checks = 0
function Assert-External([bool]$Value, [string]$Label) { if (-not $Value) { throw ('FAILED: ' + $Label) }; $script:checks++ }
function Assert-ExternalThrows([scriptblock]$Action, [string]$Label) {
    $threw = $false
    try { & $Action | Out-Null } catch { $threw = $true }
    Assert-External $threw $Label
}
foreach ($address in @('127.0.0.1','0.0.0.0','10.0.0.22','172.16.1.1','192.168.2.2','169.254.169.254','100.64.1.2','224.1.1.1','192.0.2.1','198.51.100.2','203.0.113.1','198.18.1.1','::1','fc00::1','fe80::1','ff02::1','2001:db8::1','::ffff:8.8.8.8','2002:0808:0808::1','2001:2::1','2001:10::1','2001:20::1')) {
    Assert-External (-not [Sccc.Diagnostics.ExternalProbe]::IsPublicAddress([Net.IPAddress]::Parse($address))) ('Reject nonpublic ' + $address)
}
foreach ($address in @('8.8.8.8','35.208.238.20','2606:4700:4700::1111','2001:4860:4860::8888')) {
    Assert-External ([Sccc.Diagnostics.ExternalProbe]::IsPublicAddress([Net.IPAddress]::Parse($address))) ('Allow public ' + $address)
}
foreach ($origin in @('http://probe.example.com','https://127.0.0.1','https://user@probe.example.com','https://probe.example.com/path','https://probe.example.com/?x=1','https://probe.example.com:8443','https://host.local','https://localhost')) {
    Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateOrigin($origin) } ('Reject origin ' + $origin)
}
Assert-External ([Sccc.Diagnostics.ExternalProbe]::ValidateOrigin('https://probe.example.com').Host -eq 'probe.example.com') 'HTTPS DNS origin'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateBudget('external-quick', 1, 30) } 'Exact quick bytes'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateBudget('external-quick', 5MB, 31) } 'Quick timeout'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateBudget('external-sustained', 1GB + 1, 180) } 'Sustained byte cap'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateBudget('external-sustained', 1GB, 181) } 'Sustained timeout'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateBudget('command', 1, 1) } 'Unknown operation'

$headers = "HTTP/1.1 206 Partial Content`r`nContent-Type: application/octet-stream`r`nContent-Length: 16`r`nContent-Range: bytes 0-15/1073741824`r`n`r`n"
Assert-External ([Sccc.Diagnostics.ExternalProbe]::ValidateResponse($headers, 16, 'external-sustained') -eq 206) 'Exact bounded range'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace '0-15/','1-16/'), 16, 'external-sustained') } 'Reject shifted range'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace '1073741824','999'), 16, 'external-sustained') } 'Reject incorrect object total'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace 'Content-Length: 16','Content-Length: 17'), 16, 'external-sustained') } 'Reject oversized response'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace '206 Partial Content','302 Found'), 16, 'external-sustained') } 'No redirect'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace 'Content-Type: application/octet-stream','Content-Type: text/html'), 16, 'external-sustained') } 'Reject HTML response'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace 'Content-Type:',"Content-Encoding: gzip`r`nContent-Type:"), 16, 'external-sustained') } 'No compressed representation'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace 'Content-Type:',"Transfer-Encoding: chunked`r`nContent-Type:"), 16, 'external-sustained') } 'No unbounded chunked response'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace 'Content-Type:',"Content-Length: 16`r`nContent-Type:"), 16, 'external-sustained') } 'Duplicate framing rejected'
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ValidateResponse(($headers -replace '206 Partial Content','200 OK'), 16, 'external-sustained') } 'Ignored range rejected before body'

$body = [Text.Encoding]::ASCII.GetBytes('0123456789abcdefghijklmnop')
$stream = New-Object IO.MemoryStream(,$body)
$result = New-Object Sccc.Diagnostics.ProbeResult
[Sccc.Diagnostics.ExternalProbe]::ReadBody($stream, 16, [Threading.CancellationToken]::None, $result)
Assert-External ($result.bytesReceived -eq 16 -and $stream.Position -eq 16) 'Reader stops at authorized budget'
$stream.Dispose()
$stream = New-Object IO.MemoryStream(,[Text.Encoding]::ASCII.GetBytes('short'))
$result = New-Object Sccc.Diagnostics.ProbeResult
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ReadBody($stream, 16, [Threading.CancellationToken]::None, $result) } 'Truncated body fails'
Assert-External ($result.bytesReceived -eq 5) 'Partial byte count retained'
$stream.Dispose()
$stream = New-Object IO.MemoryStream(,[Text.Encoding]::ASCII.GetBytes($headers))
Assert-External ([Sccc.Diagnostics.ExternalProbe]::ReadHeaders($stream, [Threading.CancellationToken]::None) -ceq $headers) 'Bounded header parser'
$stream.Dispose()
$stream = New-Object IO.MemoryStream(,[Text.Encoding]::ASCII.GetBytes(('X' * 65537)))
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ReadHeaders($stream, [Threading.CancellationToken]::None) } 'Header cap enforced'
$stream.Dispose()
$cancel = New-Object Threading.CancellationTokenSource
$cancel.Cancel()
$stream = New-Object IO.MemoryStream(,$body)
$result = New-Object Sccc.Diagnostics.ProbeResult
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ReadBody($stream, 16, $cancel.Token, $result) } 'Cancellation before read'
Assert-External ($result.bytesReceived -eq 0) 'Cancelled reader consumes no body'
$cancel.Dispose(); $stream.Dispose()

# A stalled provider's ReadAsync may ignore cancellation. The waiting reader
# must still return promptly, while the production cancellation hook closes TCP.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
namespace ScccDiagnosticsFixtures {
    public sealed class StalledRead : Stream {
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override Task<int> ReadAsync(byte[] b, int o, int n, CancellationToken ct) { return new TaskCompletionSource<int>().Task; }
        public override int Read(byte[] b, int o, int n) { throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long o, SeekOrigin s) { throw new NotSupportedException(); }
        public override void SetLength(long n) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int n) { throw new NotSupportedException(); }
    }
}
'@
$cancel = New-Object Threading.CancellationTokenSource
$cancel.CancelAfter(50)
$watch = [Diagnostics.Stopwatch]::StartNew()
$stream = New-Object ScccDiagnosticsFixtures.StalledRead
$result = New-Object Sccc.Diagnostics.ProbeResult
Assert-ExternalThrows { [Sccc.Diagnostics.ExternalProbe]::ReadBody($stream, 16, $cancel.Token, $result) } 'Cancellation interrupts stalled async provider'
Assert-External ($watch.Elapsed.TotalSeconds -lt 2) 'Stalled read cancellation is prompt'
$stream.Dispose(); $cancel.Dispose()

$adapter = & (Get-Module Sccc.Diagnostics) {
    function script:Get-NetIPAddress { [pscustomobject]@{ InterfaceIndex = 8; PrefixLength = 24 } }
    function script:Get-NetAdapter { [pscustomobject]@{ ifIndex = 8; Name = 'Fixture Ethernet'; MacAddress = '00-11-22-33-44-55'; NdisPhysicalMedium = 14; MediaType = 0 } }
    function script:Get-NetIPConfiguration { [pscustomobject]@{ IPv4DefaultGateway = @([pscustomobject]@{ NextHop = '10.1.2.1' }); IPv6DefaultGateway = @() } }
    Get-DiagnosticsActiveAdapter -LocalAddress '10.1.2.3'
}
Assert-External ($adapter.localIp -eq '10.1.2.3' -and $adapter.subnetPrefixLength -eq 24 -and $adapter.mac -eq '00:11:22:33:44:55' -and $adapter.gateway -eq '10.1.2.1') 'Actual local IP maps to adapter and subnet metadata'

$device = [Guid]::NewGuid().ToString(); $token = 'sccc-diag.' + ('a' * 43)
function New-ExternalJob([string]$Kind, [long]$Bytes, [int]$Seconds) {
    $job = [pscustomobject]@{ id = [Guid]::NewGuid().ToString(); expiresAt = [DateTimeOffset]::UtcNow.AddMinutes(4).ToString('o'); type = $Kind; targetOrigin = 'https://probe.example.com'; downloadBytes = $Bytes; uploadBytes = 0; pingCount = 1; timeoutSeconds = $Seconds; proofVersion = 2; proof = '' }
    $canonical = 'v2|{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}' -f $job.id,$device,$job.expiresAt,$job.type,$job.targetOrigin,$job.downloadBytes,$job.uploadBytes,$job.pingCount,$job.timeoutSeconds
    $hmac = New-Object Security.Cryptography.HMACSHA256(,[Text.Encoding]::UTF8.GetBytes($token))
    try { $job.proof = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).TrimEnd('=').Replace('+','-').Replace('/','_') } finally { $hmac.Dispose() }
    return $job
}
$job = New-ExternalJob 'external-quick' 5MB 30
$valid = Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token -ExternalProbeOrigin 'https://probe.example.com'
Assert-External ($valid.Type -ceq 'external-quick' -and $valid.DownloadBytes -eq 5MB) 'Signed v2 quick job'
Assert-ExternalThrows { Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token } 'External target must be configured locally'
Assert-ExternalThrows { Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token -ExternalProbeOrigin 'https://other.example.com' } 'No target substitution'
$job.timeoutSeconds = 29
Assert-ExternalThrows { Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token -ExternalProbeOrigin 'https://probe.example.com' } 'Timeout tampering invalidates proof'
$job = New-ExternalJob 'external-sustained' 64MB 180
Assert-ExternalThrows { Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token -ExternalProbeOrigin 'https://probe.example.com' } 'Sustained denied by local default'
$valid = Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token -ExternalProbeOrigin 'https://probe.example.com' -PermitSustained $true
Assert-External ($valid.DownloadBytes -eq 64MB -and $valid.TimeoutSeconds -eq 180) 'Explicit sustained permission'
Assert-ExternalThrows { Test-DiagnosticsJob -Job $job -DeviceId ([Guid]::NewGuid().ToString()) -DeviceToken $token -ExternalProbeOrigin 'https://probe.example.com' -PermitSustained $true } 'External job is device bound'
$job = New-ExternalJob 'librespeed-v2' 0 180
$job.targetOrigin = 'https://denspeed.sharktech.net'
$canonical = 'v2|{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}' -f $job.id,$device,$job.expiresAt,$job.type,$job.targetOrigin,$job.downloadBytes,$job.uploadBytes,$job.pingCount,$job.timeoutSeconds
$hmac = New-Object Security.Cryptography.HMACSHA256(,[Text.Encoding]::UTF8.GetBytes($token))
try { $job.proof = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).TrimEnd('=').Replace('+','-').Replace('/','_') } finally { $hmac.Dispose() }
$valid = Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token
Assert-External ($valid.Type -ceq 'librespeed-v2' -and $valid.TargetOrigin -ceq 'https://denspeed.sharktech.net' -and $valid.DownloadBytes -eq 0 -and $valid.UploadBytes -eq 0 -and $valid.TimeoutSeconds -eq 180) 'Pinned zero-budget LibreSpeed V2 job'
$job.targetOrigin = 'https://probe.example.com'
Assert-ExternalThrows { Test-DiagnosticsJob -Job $job -DeviceId $device -DeviceToken $token } 'LibreSpeed server substitution rejected'
Write-Output ('PASS: {0} external-probe offline assertions; no DNS, TCP, TLS or transfer was run.' -f $script:checks)
