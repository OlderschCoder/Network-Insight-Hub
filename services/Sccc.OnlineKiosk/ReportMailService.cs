using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

internal sealed class ReportMailService
{
    private readonly HttpClient http;
    private readonly string endpoint;
    private readonly string notificationEndpoint;
    private readonly string keyPath;

    public ReportMailService(IHttpClientFactory factory, IConfiguration cfg)
    {
        http = factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(30);
        endpoint = cfg["PASSWORD_RESET_REPORT_MAIL_URL"] ?? "http://127.0.0.1:8080/api/internal/password-reset-report";
        notificationEndpoint = cfg["PASSWORD_RESET_NOTIFICATION_MAIL_URL"]
            ?? "http://127.0.0.1:8080/api/internal/student-password-reset-notification";
        keyPath = cfg["KIOSK_DEVICE_KEY_PATH"] ?? "/var/lib/sccc-mfa/kiosk-device.key";
    }

    public async Task Send(string subject, string html, byte[] csv, string csvFileName)
    {
        if (!File.Exists(keyPath)) throw new InvalidOperationException("The kiosk reporting authentication key is unavailable.");
        byte[] key = await File.ReadAllBytesAsync(keyPath);
        if (key.Length < 32) throw new InvalidOperationException("The kiosk reporting authentication key is invalid.");

        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        string htmlHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(html))).ToLowerInvariant();
        string csvHash = Convert.ToHexString(SHA256.HashData(csv)).ToLowerInvariant();
        string signatureInput = timestamp + "\n" + subject + "\n" + htmlHash + "\n" + csvHash;
        string signature = Convert.ToHexString(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(signatureInput))).ToLowerInvariant();
        string body = JsonSerializer.Serialize(new
        {
            subject,
            html,
            csvFileName,
            csvBase64 = Convert.ToBase64String(csv)
        });

        using HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Add("X-SCCC-Report-Timestamp", timestamp.ToString());
        request.Headers.Add("X-SCCC-Report-Signature", signature);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("The internal IT mail service rejected the password reset report (HTTP " + (int)response.StatusCode + ").");
        }
    }

    public async Task SendStudentPasswordResetNotification(
        string recipient,
        string displayName,
        DateTimeOffset changedUtc,
        string sourceIp)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(
            recipient,
            @"^[a-z0-9][a-z0-9._-]{0,63}@g\.sccc\.edu$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase
                | System.Text.RegularExpressions.RegexOptions.CultureInvariant))
            throw new InvalidOperationException("The student notification address is not an approved SCCC student address.");

        if (!File.Exists(keyPath)) throw new InvalidOperationException("The kiosk reporting authentication key is unavailable.");
        byte[] key = await File.ReadAllBytesAsync(keyPath);
        if (key.Length < 32) throw new InvalidOperationException("The kiosk reporting authentication key is invalid.");

        const string subject = "SCCC password changed through OnlineKiosk";
        string html = $"""
        <html><body style="font-family:Segoe UI,Arial,sans-serif;color:#172b23">
        <h2>Your SCCC password was changed</h2>
        <p>Hello {WebUtility.HtmlEncode(displayName)},</p>
        <p>Your SCCC account password was changed through <b>OnlineKiosk</b>
        on {WebUtility.HtmlEncode(changedUtc.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss 'UTC'"))}.</p>
        <p>The request came from IP address <b>{WebUtility.HtmlEncode(sourceIp)}</b>.</p>
        <p>No password or Temporary Access Pass is included in this message.</p>
        <p>If you made this change, no action is required. If you did not make it,
        contact SCCC IT immediately at <a href="mailto:itech@sccc.edu">itech@sccc.edu</a>
        or (620) 417-1200.</p>
        </body></html>
        """;

        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        string htmlHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(html))).ToLowerInvariant();
        string signatureInput = timestamp + "\n" + recipient.ToLowerInvariant() + "\n" + subject + "\n" + htmlHash;
        string signature = Convert.ToHexString(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(signatureInput))).ToLowerInvariant();
        string body = JsonSerializer.Serialize(new
        {
            recipient = recipient.ToLowerInvariant(),
            subject,
            html
        });

        using HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, notificationEndpoint);
        request.Headers.Add("X-SCCC-Report-Timestamp", timestamp.ToString());
        request.Headers.Add("X-SCCC-Report-Signature", signature);
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        using HttpResponseMessage response = await http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                "The internal IT mail service rejected the student security notification (HTTP "
                + (int)response.StatusCode + ").");
        }
    }
}
