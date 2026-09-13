using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Hosting;

internal sealed class PasswordResetActivityReporter : BackgroundService
{
    private static readonly Regex AccountPattern = new(
        @"^[a-z0-9][a-z0-9._-]{0,63}@sccc\.edu$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private readonly HttpClient http;
    private readonly string endpoint;
    private readonly string keyPath;
    private readonly string outboxPath;
    private readonly SemaphoreSlim flushLock = new(1, 1);

    public PasswordResetActivityReporter(IHttpClientFactory factory, IConfiguration cfg)
    {
        http = factory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(15);
        endpoint = cfg["PASSWORD_RESET_ACTIVITY_URL"]
            ?? "http://10.0.0.44:8080/api/internal/online-kiosk-reset-activity";
        keyPath = cfg["KIOSK_DEVICE_KEY_PATH"]
            ?? "/var/lib/sccc-online-kiosk/mail-signing.key";
        outboxPath = cfg["PASSWORD_RESET_ACTIVITY_OUTBOX_PATH"]
            ?? "/var/lib/sccc-online-kiosk/activity-outbox";
    }

    public async Task<bool> QueueAndTrySend(
        string account,
        string sourceIp,
        DateTimeOffset occurredUtc,
        CancellationToken cancellationToken = default)
    {
        account = account.Trim().ToLowerInvariant();
        sourceIp = sourceIp.Trim();
        if (!AccountPattern.IsMatch(account) || !IPAddress.TryParse(sourceIp, out _))
            throw new InvalidOperationException("The password-reset activity record is invalid.");

        PasswordResetActivityEvent activity = new(
            Guid.NewGuid().ToString("D"),
            occurredUtc.ToUniversalTime().ToString("O"),
            account,
            sourceIp);

        Directory.CreateDirectory(outboxPath);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                outboxPath,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        string finalPath = Path.Combine(outboxPath, activity.EventId + ".json");
        string temporaryPath = finalPath + ".tmp";
        string json = JsonSerializer.Serialize(activity, JsonOptions);
        await File.WriteAllTextAsync(temporaryPath, json, Encoding.UTF8, cancellationToken);
        File.Move(temporaryPath, finalPath, true);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(finalPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);

        await Flush(cancellationToken);
        return !File.Exists(finalPath);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Flush(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("OnlineKiosk activity retry failed: {0}", ex.Message);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task Flush(CancellationToken cancellationToken)
    {
        await flushLock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(outboxPath);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(
                    outboxPath,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
            foreach (string path in Directory.EnumerateFiles(outboxPath, "*.json").OrderBy(value => value))
            {
                cancellationToken.ThrowIfCancellationRequested();
                PasswordResetActivityEvent? activity;
                try
                {
                    string json = await File.ReadAllTextAsync(path, cancellationToken);
                    activity = JsonSerializer.Deserialize<PasswordResetActivityEvent>(json, JsonOptions);
                    if (activity is null || !Valid(activity))
                        throw new InvalidDataException("Invalid OnlineKiosk activity outbox record.");
                }
                catch (Exception ex) when (ex is JsonException or InvalidDataException)
                {
                    Console.Error.WriteLine("OnlineKiosk activity outbox record is invalid: {0}", Path.GetFileName(path));
                    continue;
                }

                if (!await TrySend(activity, cancellationToken))
                    continue;

                File.Delete(path);
            }
        }
        finally
        {
            flushLock.Release();
        }
    }

    private async Task<bool> TrySend(
        PasswordResetActivityEvent activity,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(keyPath))
            return false;

        byte[] key = await File.ReadAllBytesAsync(keyPath, cancellationToken);
        if (key.Length < 32)
            return false;

        long timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        string timestampText = timestamp.ToString();
        string signatureInput = timestampText
            + "\n" + activity.EventId
            + "\n" + activity.Utc
            + "\n" + activity.Account
            + "\n" + activity.SourceIp;
        string signature = Convert.ToHexString(
            HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(signatureInput)))
            .ToLowerInvariant();

        using HttpRequestMessage request = new(HttpMethod.Post, endpoint);
        request.Headers.Add("X-SCCC-Report-Timestamp", timestampText);
        request.Headers.Add("X-SCCC-Report-Signature", signature);
        request.Content = new StringContent(
            JsonSerializer.Serialize(activity, JsonOptions),
            Encoding.UTF8,
            "application/json");

        try
        {
            using HttpResponseMessage response = await http.SendAsync(request, cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("OnlineKiosk activity delivery deferred: {0}", ex.Message);
            return false;
        }
    }

    private static bool Valid(PasswordResetActivityEvent activity) =>
        Guid.TryParseExact(activity.EventId, "D", out _)
        && DateTimeOffset.TryParse(activity.Utc, out _)
        && AccountPattern.IsMatch(activity.Account)
        && IPAddress.TryParse(activity.SourceIp, out _);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed record PasswordResetActivityEvent(
        string EventId,
        string Utc,
        string Account,
        string SourceIp);
}
