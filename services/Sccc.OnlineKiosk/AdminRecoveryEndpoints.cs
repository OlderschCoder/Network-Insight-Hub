using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Antiforgery;

internal sealed record AdminRecoveryActor(int Id, string Name, string Role);

internal sealed record AdminRecoveryRequest(
    string LegalFirstName,
    string LegalLastName,
    string StudentId,
    string Username,
    int ZendeskTicketId,
    string VerificationMethod,
    bool IdentityVerified,
    bool Confirmed,
    AdminRecoveryActor Actor);

internal sealed class AdminRecoverySecurity
{
    private static readonly TimeSpan AllowedSkew = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, DateTimeOffset> nonces = new();
    private readonly IConfiguration cfg;

    public AdminRecoverySecurity(IConfiguration cfg)
    {
        this.cfg = cfg;
    }

    public async Task<(bool Valid, string Error)> Verify(HttpContext context, string body)
    {
        string caller = context.Connection.RemoteIpAddress?.MapToIPv4().ToString() ?? "";
        string allowedCaller = cfg["ADMIN_RECOVERY_ALLOWED_IP"] ?? "10.0.0.44";
        if (!string.Equals(caller, allowedCaller, StringComparison.Ordinal))
            return (false, "The recovery broker does not accept requests from this host.");

        string timestampText = context.Request.Headers["X-SCCC-Timestamp"].ToString();
        string nonce = context.Request.Headers["X-SCCC-Nonce"].ToString();
        string signature = context.Request.Headers["X-SCCC-Signature"].ToString();
        if (!long.TryParse(timestampText, out long timestamp)
            || !Regex.IsMatch(nonce, "^[a-f0-9]{32,96}$", RegexOptions.CultureInvariant)
            || !Regex.IsMatch(signature, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant))
        {
            return (false, "The recovery broker signature is invalid.");
        }

        DateTimeOffset signedAt;
        try { signedAt = DateTimeOffset.FromUnixTimeSeconds(timestamp); }
        catch (ArgumentOutOfRangeException)
        {
            return (false, "The recovery broker timestamp is invalid.");
        }
        if ((DateTimeOffset.UtcNow - signedAt).Duration() > AllowedSkew)
            return (false, "The recovery broker request expired.");

        string keyPath = cfg["ADMIN_RECOVERY_HMAC_KEY_PATH"]
            ?? "/etc/sccc-identity-recovery.key";
        if (!File.Exists(keyPath))
            return (false, "The recovery broker signing key is not configured.");
        string key = (await File.ReadAllTextAsync(keyPath)).Trim();
        if (key.Length < 32)
            return (false, "The recovery broker signing key is invalid.");

        byte[] expected = ComputeSignature(key, timestampText, nonce, body);
        byte[] supplied;
        try { supplied = Convert.FromHexString(signature); }
        catch (FormatException)
        {
            return (false, "The recovery broker signature is invalid.");
        }
        if (!CryptographicOperations.FixedTimeEquals(expected, supplied))
            return (false, "The recovery broker signature is invalid.");

        DateTimeOffset now = DateTimeOffset.UtcNow;
        foreach ((string storedNonce, DateTimeOffset expires) in nonces)
            if (expires <= now) nonces.TryRemove(storedNonce, out _);
        if (!nonces.TryAdd(nonce, now.Add(AllowedSkew)))
            return (false, "The recovery broker request was already used.");
        return (true, "");
    }

    internal static byte[] ComputeSignature(
        string key,
        string timestamp,
        string nonce,
        string body) => HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(key),
            Encoding.UTF8.GetBytes($"{timestamp}\n{nonce}\n{body}"));
}

internal static class AdminRecoveryEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    private static readonly HashSet<string> AllowedVerificationMethods = new(
        new[]
        {
            "in_person_photo_id",
            "callback_to_number_on_file",
            "live_video_photo_id",
        },
        StringComparer.Ordinal);

    public static void MapAdminRecovery(this WebApplication app, IConfiguration cfg)
    {
        app.MapPost("/internal/admin-recovery-link", async (
            HttpContext context,
            AdminRecoverySecurity security,
            OnlineIdentityService identities,
            GraphService graph,
            AuditStore audit) =>
        {
            if (!OnlineKioskEndpoints.Enabled(cfg))
                return Results.Json(
                    new { error = "OnlineKiosk is temporarily unavailable." },
                    statusCode: 503);
            if (context.Request.ContentLength is > 16_384)
                return Results.Json(new { error = "Request is too large." }, statusCode: 413);

            using StreamReader reader = new(context.Request.Body, Encoding.UTF8);
            string body = await reader.ReadToEndAsync();
            if (Encoding.UTF8.GetByteCount(body) > 16_384)
                return Results.Json(new { error = "Request is too large." }, statusCode: 413);
            (bool valid, string signatureError) = await security.Verify(context, body);
            if (!valid)
                return Results.Json(new { error = signatureError }, statusCode: 401);

            AdminRecoveryRequest? request;
            try { request = JsonSerializer.Deserialize<AdminRecoveryRequest>(body, JsonOptions); }
            catch (JsonException)
            {
                return Results.Json(new { error = "The recovery request is invalid." }, statusCode: 400);
            }
            string? inputError = Validate(request);
            if (inputError is not null)
                return Results.Json(new { error = inputError }, statusCode: 400);

            string username = NormalizeUsername(request!.Username)!;
            string actor = $"insights:{request.Actor.Id}:{AuditText(request.Actor.Name, 80)}";
            string callerIp = context.Connection.RemoteIpAddress?.MapToIPv4().ToString() ?? "unknown";
            string reason =
                $"Zendesk #{request.ZendeskTicketId}; verification={request.VerificationMethod}";
            try
            {
                Eligibility? nameMatch = await graph.FindRegularStudentByIdentity(
                    request.LegalFirstName,
                    request.LegalLastName,
                    request.StudentId);
                Eligibility? usernameMatch = await graph.FindRegularStudent(
                    username,
                    request.StudentId);
                if (nameMatch is null
                    || usernameMatch is null
                    || !string.Equals(nameMatch.Id, usernameMatch.Id, StringComparison.OrdinalIgnoreCase)
                    || !await graph.IsOnlineKioskStudentAccount(nameMatch.Id))
                {
                    await audit.Write(
                        "admin-recovery-link",
                        "denied",
                        actor,
                        "unknown",
                        callerIp,
                        null,
                        reason + "; no unique active student match",
                        null);
                    return Results.Json(
                        new { error = "The supplied identity did not match one unique active SCCC student account. No account was changed." },
                        statusCode: 404);
                }

                string? notificationEmail = await graph.GetStudentNotificationEmail(nameMatch.Id);
                if (notificationEmail is null)
                {
                    await audit.Write(
                        "admin-recovery-link",
                        "denied",
                        actor,
                        nameMatch.Id,
                        callerIp,
                        null,
                        reason + "; no approved notification address",
                        null);
                    return Results.Json(
                        new { error = "The official notification address could not be verified. No account was changed." },
                        statusCode: 409);
                }

                const int minutes = 10;
                string grant = identities.CreateGrant(
                    nameMatch.Id,
                    nameMatch.Upn,
                    nameMatch.DisplayName,
                    nameMatch.StudentId,
                    actor,
                    assisted: true,
                    minutes: minutes);
                string publicBase = (cfg["ONLINE_KIOSK_PUBLIC_BASE_URL"]
                    ?? "https://app-server2.centralus.cloudapp.azure.com").TrimEnd('/');
                string recoveryUrl = $"{publicBase}/online-kiosk/assisted/{grant}";
                DateTimeOffset expiresUtc = DateTimeOffset.UtcNow.AddMinutes(minutes);

                await audit.Write(
                    "admin-recovery-link",
                    "success",
                    actor,
                    nameMatch.Id,
                    callerIp,
                    null,
                    reason + "; ten-minute assisted link issued",
                    null);
                return Results.Json(new
                {
                    status = "ready",
                    recoveryUrl,
                    expiresUtc,
                    displayName = nameMatch.DisplayName,
                    upn = nameMatch.Upn,
                });
            }
            catch (GraphRequestException ex)
            {
                await audit.Write(
                    "admin-recovery-link",
                    "failed",
                    actor,
                    "unknown",
                    callerIp,
                    null,
                    reason + "; " + ex.SafeMessage,
                    ex.RequestId);
                return Results.Json(
                    new
                    {
                        error = "Microsoft Entra could not verify the account. No account was changed.",
                        requestId = ex.RequestId,
                    },
                    statusCode: 502);
            }
        }).AllowAnonymous();

        app.MapGet("/online-kiosk/assisted/{grantToken}", async (
            string grantToken,
            HttpContext context,
            IAntiforgery antiforgery,
            OnlineIdentityService identities,
            GraphService graph,
            AuditStore audit) =>
        {
            if (!OnlineKioskEndpoints.Enabled(cfg))
                return OnlineKioskEndpoints.ErrorPage(
                    "OnlineKiosk unavailable",
                    "No account was changed. Contact SCCC IT.",
                    503,
                    cfg);
            string ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            if (!identities.AllowAttempt("assisted-link:" + ip, 30, 15))
                return OnlineKioskEndpoints.ErrorPage(
                    "Too many attempts",
                    "Wait 15 minutes or contact SCCC IT. No account was changed.",
                    429,
                    cfg);

            KioskGrant? grant = identities.GetGrant(grantToken);
            if (grant is null || !grant.Assisted)
                return OnlineKioskEndpoints.ErrorPage(
                    "Reset link expired",
                    "Ask SCCC IT to prepare a new assisted reset link. No account was changed.",
                    410,
                    cfg);
            if (!await graph.IsOnlineKioskStudentAccount(grant.ObjectId))
            {
                await audit.Write(
                    "admin-recovery-link",
                    "denied",
                    grant.Actor,
                    grant.ObjectId,
                    ip,
                    null,
                    "Account was no longer an active SCCC student when the assisted link was opened",
                    null);
                return OnlineKioskEndpoints.ErrorPage(
                    "Account unavailable",
                    "This account is not currently eligible for assisted recovery. No account was changed.",
                    403,
                    cfg);
            }
            string? notificationEmail = await graph.GetStudentNotificationEmail(grant.ObjectId);
            if (notificationEmail is null)
                return OnlineKioskEndpoints.ErrorPage(
                    "Email verification unavailable",
                    "The official notification address could not be verified. No account was changed.",
                    409,
                    cfg);

            string requestToken = antiforgery.GetAndStoreTokens(context).RequestToken ?? "";
            return OnlineKioskEndpoints.ConfirmationPage(
                new Eligibility(
                    true,
                    grant.ObjectId,
                    grant.DisplayName,
                    grant.Upn,
                    grant.StudentId,
                    null),
                grantToken,
                requestToken,
                notificationEmail,
                cfg);
        }).AllowAnonymous();
    }

    internal static string? Validate(AdminRecoveryRequest? request)
    {
        if (request is null) return "The recovery request is invalid.";
        if (!request.Confirmed || !request.IdentityVerified)
            return "Independent identity verification and explicit confirmation are required.";
        if (request.Actor is null
            || request.Actor.Id < 1
            || !(string.Equals(request.Actor.Role, "cio", StringComparison.OrdinalIgnoreCase)
                || string.Equals(request.Actor.Role, "helpdesk", StringComparison.OrdinalIgnoreCase)))
            return "The signed-in operator is not authorized for student identity recovery.";
        if (!Regex.IsMatch(request.LegalFirstName ?? "", @"^[\p{L}][\p{L}' -]{0,79}$"))
            return "A valid legal first name is required.";
        if (!Regex.IsMatch(request.LegalLastName ?? "", @"^[\p{L}][\p{L}' -]{0,79}$"))
            return "A valid legal last name is required.";
        if (!Regex.IsMatch(request.StudentId ?? "", @"^800[0-9]{6}$"))
            return "The full nine-digit student number beginning with 800 is required.";
        if (NormalizeUsername(request.Username) is null)
            return "A valid SCCC username is required.";
        if (request.ZendeskTicketId < 1)
            return "A valid Zendesk ticket ID is required.";
        if (!AllowedVerificationMethods.Contains(request.VerificationMethod ?? ""))
            return "Use an approved independent identity-verification method.";
        return null;
    }

    private static string? NormalizeUsername(string? value)
    {
        string username = (value ?? "").Trim().ToLowerInvariant();
        if (!username.Contains('@')) username += "@sccc.edu";
        return Regex.IsMatch(
            username,
            @"^[a-z0-9][a-z0-9._-]{0,63}@sccc\.edu$",
            RegexOptions.CultureInvariant)
            ? username
            : null;
    }

    private static string AuditText(string? value, int max)
    {
        string cleaned = Regex.Replace((value ?? "").Trim(), @"[^\p{L}\p{N} .,'_-]", "");
        return cleaned.Length <= max ? cleaned : cleaned[..max];
    }
}
