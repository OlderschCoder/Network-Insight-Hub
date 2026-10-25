using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]
[assembly: AssemblyTitle("SCCC Building Diagnostics External Probe")]
[assembly: AssemblyProduct("SCCC Building Diagnostics")]

namespace Sccc.Diagnostics
{
    public sealed class ProbeResult
    {
        public string type, targetOrigin, path, timestamp, failure, remoteAddress, localAddress;
        public string[] dnsAddresses;
        public double? dnsMs, tcpConnectMs, tlsMs, ttfbMs;
        public int httpStatus;
        public long bytesReceived;
        public double elapsedMs, mbps;
    }

    // No credentials, cookies, proxy credentials, redirects or user payloads are
    // accepted by this API. The caller supplies a locally allowlisted origin.
    public static class ExternalProbe
    {
        public const long QuickBytes = 5242880L;
        public const long SustainedObjectBytes = 1073741824L;
        public const int MaximumHeaders = 65536;

        public static Uri ValidateOrigin(string value)
        {
            Uri uri;
            IPAddress literal;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || uri.Scheme != "https" ||
                !uri.IsDefaultPort || uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" ||
                uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
                Uri.CheckHostName(uri.IdnHost) != UriHostNameType.Dns ||
                IPAddress.TryParse(uri.IdnHost, out literal) || !uri.IdnHost.Contains(".") ||
                uri.IdnHost.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) ||
                uri.IdnHost.EndsWith(".local", StringComparison.OrdinalIgnoreCase) ||
                uri.IdnHost.EndsWith(".internal", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("External probe requires an HTTPS DNS origin on port 443.");
            return uri;
        }

        public static bool IsPublicAddress(IPAddress address)
        {
            if (address == null || IPAddress.IsLoopback(address)) return false;
            byte[] b = address.GetAddressBytes();
            if (address.AddressFamily == AddressFamily.InterNetwork)
            {
                return b[0] != 0 && b[0] != 10 && b[0] != 127 && b[0] < 224 &&
                    !(b[0] == 100 && b[1] >= 64 && b[1] <= 127) &&
                    !(b[0] == 169 && b[1] == 254) && !(b[0] == 172 && b[1] >= 16 && b[1] <= 31) &&
                    !(b[0] == 192 && (b[1] == 168 || b[1] == 0 || (b[1] == 0 && b[2] == 2))) &&
                    !(b[0] == 198 && (b[1] == 18 || b[1] == 19 || (b[1] == 51 && b[2] == 100))) &&
                    !(b[0] == 203 && b[1] == 0 && b[2] == 113);
            }
            // Only native global unicast IPv6. Reject mapped IPv4, local,
            // multicast, documentation and transition ranges conservatively.
            return address.AddressFamily == AddressFamily.InterNetworkV6 && (b[0] & 0xe0) == 0x20 &&
                !(b[0] == 0x20 && b[1] == 0x02) &&
                !(b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) &&
                !(b[0] == 0x20 && b[1] == 0x01 && b[2] < 2);
        }

        public static void ValidateBudget(string type, long bytes, int seconds)
        {
            if (type == "external-quick")
            {
                if (bytes != QuickBytes || seconds < 1 || seconds > 30) throw new ArgumentException("Invalid quick probe limits.");
            }
            else if (type == "external-sustained")
            {
                if (bytes < 1 || bytes > SustainedObjectBytes || seconds < 1 || seconds > 180) throw new ArgumentException("Invalid sustained probe limits.");
            }
            else throw new ArgumentException("Unknown external probe operation.");
        }

        public static Task<ProbeResult> Start(string origin, string type, long budget, int timeoutSeconds, CancellationToken cancellation)
        {
            ValidateOrigin(origin);
            ValidateBudget(type, budget, timeoutSeconds);
            // Task does not capture PowerShell's runspace. Cancellation closes the
            // socket, including blocked TLS/body operations on .NET Framework.
            return Task.Run(() => Run(origin, type, budget, timeoutSeconds, cancellation));
        }

        private static ProbeResult Run(string origin, string type, long budget, int timeoutSeconds, CancellationToken cancellation)
        {
            Uri uri = ValidateOrigin(origin);
            string path = type == "external-quick" ? "/probe-5mb.bin" : "/probe-1gb.bin";
            ProbeResult result = new ProbeResult { type = type, targetOrigin = origin.TrimEnd('/'), path = path,
                timestamp = DateTimeOffset.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
            Stopwatch whole = Stopwatch.StartNew(), requestWatch = null;
            string phase = "dns";
            using (CancellationTokenSource deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
            {
                deadline.CancelAfter(timeoutSeconds * 1000);
                TcpClient tcp = null;
                try
                {
                    deadline.Token.ThrowIfCancellationRequested();
                    Stopwatch stage = Stopwatch.StartNew();
                    Task<IPAddress[]> lookup = Dns.GetHostAddressesAsync(uri.IdnHost);
                    lookup.Wait(deadline.Token);
                    IPAddress[] addresses = lookup.GetAwaiter().GetResult();
                    result.dnsMs = stage.Elapsed.TotalMilliseconds;
                    if (addresses.Length == 0) throw new InvalidDataException("No addresses.");
                    foreach (IPAddress address in addresses)
                        if (!IsPublicAddress(address)) throw new InvalidDataException("Non-public DNS answer.");
                    result.dnsAddresses = new string[Math.Min(16, addresses.Length)];
                    for (int i = 0; i < result.dnsAddresses.Length; i++) result.dnsAddresses[i] = addresses[i].ToString();
                    // The connection uses the exact checked address. TLS still
                    // verifies the original DNS hostname through SNI normally.
                    IPAddress selected = addresses[0];
                    foreach (IPAddress address in addresses) { if (address.AddressFamily == AddressFamily.InterNetwork) { selected = address; break; } }
                    tcp = new TcpClient(selected.AddressFamily);
                    using (deadline.Token.Register(() => { try { tcp.Close(); } catch (ObjectDisposedException) { } }))
                    {
                        phase = "tcp"; stage.Restart();
                        Task connection = tcp.ConnectAsync(selected, 443);
                        connection.Wait(deadline.Token); connection.GetAwaiter().GetResult();
                        result.tcpConnectMs = stage.Elapsed.TotalMilliseconds;
                        result.remoteAddress = ((IPEndPoint)tcp.Client.RemoteEndPoint).Address.ToString();
                        result.localAddress = ((IPEndPoint)tcp.Client.LocalEndPoint).Address.ToString();
                        using (SslStream tls = new SslStream(tcp.GetStream(), false))
                        {
                            phase = "tls"; stage.Restart();
                            Task auth = tls.AuthenticateAsClientAsync(uri.IdnHost, null, SslProtocols.Tls12, true);
                            auth.Wait(deadline.Token); auth.GetAwaiter().GetResult();
                            result.tlsMs = stage.Elapsed.TotalMilliseconds;
                            phase = "http"; requestWatch = Stopwatch.StartNew();
                            string request = "GET " + path + " HTTP/1.1\r\nHost: " + uri.IdnHost +
                                "\r\nUser-Agent: SCCC-Diagnostics/1.1.0\r\nAccept: application/octet-stream\r\n" +
                                "Accept-Encoding: identity\r\nCache-Control: no-cache\r\nConnection: close\r\nRange: bytes=0-" +
                                (budget - 1).ToString(CultureInfo.InvariantCulture) + "\r\n\r\n";
                            byte[] requestBytes = Encoding.ASCII.GetBytes(request);
                            Task writing = tls.WriteAsync(requestBytes, 0, requestBytes.Length, deadline.Token);
                            writing.Wait(deadline.Token); writing.GetAwaiter().GetResult();
                            string headers = ReadHeaders(tls, deadline.Token, () => { result.ttfbMs = requestWatch.Elapsed.TotalMilliseconds; });
                            int statusCode;
                            string[] statusFields = headers.Split(new string[] { "\r\n" }, StringSplitOptions.None)[0].Split(' ');
                            if (statusFields.Length >= 2 && Int32.TryParse(statusFields[1], NumberStyles.None, CultureInfo.InvariantCulture, out statusCode)) result.httpStatus = statusCode;
                            ValidateResponse(headers, budget, type);
                            phase = "body";
                            ReadBody(tls, budget, deadline.Token, result);
                            requestWatch.Stop();
                        }
                    }
                }
                catch (Exception error)
                {
                    Exception actual = error.GetBaseException();
                    result.failure = cancellation.IsCancellationRequested ? "cancelled" : deadline.IsCancellationRequested ? "timeout" :
                        actual is AuthenticationException ? "tls_validation_failed" : phase + "_failed";
                    // Do not return exception text, DNS records, credentials or
                    // response bodies. The stage and status are sufficient.
                }
                finally
                {
                    if (tcp != null) tcp.Close();
                    if (requestWatch != null) requestWatch.Stop();
                    result.elapsedMs = Math.Max(0.001, requestWatch == null ? whole.Elapsed.TotalMilliseconds : requestWatch.Elapsed.TotalMilliseconds);
                    result.mbps = Math.Round(result.bytesReceived * 8.0 / (result.elapsedMs * 1000.0), 6);
                }
            }
            return result;
        }

        public static string ReadHeaders(Stream stream, CancellationToken token)
        {
            return ReadHeaders(stream, token, null);
        }

        public static string ReadHeaders(Stream stream, CancellationToken token, Action firstByte)
        {
            using (MemoryStream header = new MemoryStream())
            {
                byte[] one = new byte[1];
                int suffix = 0;
                while (header.Length < MaximumHeaders)
                {
                    Task<int> reading = stream.ReadAsync(one, 0, 1, token);
                    reading.Wait(token);
                    if (reading.GetAwaiter().GetResult() != 1) throw new InvalidDataException("Incomplete headers.");
                    if (header.Length == 0 && firstByte != null) firstByte();
                    header.WriteByte(one[0]);
                    suffix = (suffix << 8) | one[0];
                    if (suffix == 0x0d0a0d0a) return Encoding.ASCII.GetString(header.ToArray());
                }
                throw new InvalidDataException("Header limit exceeded.");
            }
        }

        public static int ValidateResponse(string headers, long budget, string type)
        {
            if (headers == null || headers.Length > MaximumHeaders || !headers.EndsWith("\r\n\r\n", StringComparison.Ordinal)) throw new InvalidDataException("Invalid headers.");
            string[] lines = headers.Split(new string[] { "\r\n" }, StringSplitOptions.None);
            string[] status = lines[0].Split(' ');
            int code;
            if (status.Length < 2 || (status[0] != "HTTP/1.1" && status[0] != "HTTP/1.0") ||
                !Int32.TryParse(status[1], NumberStyles.None, CultureInfo.InvariantCulture, out code)) throw new InvalidDataException("Invalid HTTP status.");
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 1; i < lines.Length; i++)
            {
                if (lines[i].Length == 0) continue;
                int colon = lines[i].IndexOf(':');
                if (colon <= 0 || Char.IsWhiteSpace(lines[i][0])) throw new InvalidDataException("Malformed header.");
                string name = lines[i].Substring(0, colon), value = lines[i].Substring(colon + 1).Trim();
                if (values.ContainsKey(name)) throw new InvalidDataException("Duplicate header.");
                values.Add(name, value);
            }
            string contentLength, encoding, mediaType, range;
            long length;
            if ((code != 200 && code != 206) || !values.TryGetValue("Content-Length", out contentLength) ||
                !Int64.TryParse(contentLength, NumberStyles.None, CultureInfo.InvariantCulture, out length) || length != budget ||
                values.ContainsKey("Transfer-Encoding") ||
                (values.TryGetValue("Content-Encoding", out encoding) && !String.Equals(encoding, "identity", StringComparison.OrdinalIgnoreCase)) ||
                !values.TryGetValue("Content-Type", out mediaType) || !String.Equals(mediaType.Split(';')[0].Trim(), "application/octet-stream", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Unexpected HTTP transfer representation.");
            long total = type == "external-quick" ? QuickBytes : SustainedObjectBytes;
            if (code == 206 && (!values.TryGetValue("Content-Range", out range) || range != "bytes 0-" + (budget - 1).ToString(CultureInfo.InvariantCulture) + "/" + total.ToString(CultureInfo.InvariantCulture)))
                throw new InvalidDataException("Unexpected byte range.");
            if (code == 200 && budget != total) throw new InvalidDataException("Server ignored the bounded range.");
            return code;
        }

        public static void ReadBody(Stream stream, long budget, CancellationToken token, ProbeResult result)
        {
            byte[] buffer = new byte[65536];
            while (result.bytesReceived < budget)
            {
                token.ThrowIfCancellationRequested();
                int needed = (int)Math.Min(buffer.Length, budget - result.bytesReceived);
                Task<int> reading = stream.ReadAsync(buffer, 0, needed, token);
                reading.Wait(token);
                int count = reading.GetAwaiter().GetResult();
                if (count == 0) throw new InvalidDataException("Incomplete transfer.");
                result.bytesReceived += count;
            }
        }
    }
}
