using System;
using System.Linq;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

internal static class OnlineKioskEndpoints
{
    private static readonly TimeSpan ResetWindow = TimeSpan.FromDays(30);

    public static void MapOnlineKiosk(this WebApplication app, IConfiguration cfg)
    {
        app.MapGet("/online-password-reset", () => Results.Redirect("/online-kiosk")).AllowAnonymous();

        app.MapGet("/tap-copy.js", (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store, max-age=0";
            return Results.Text(
                """
                (() => {
                  const button = document.getElementById("copy-pass");
                  const code = document.getElementById("tap-code");
                  const status = document.getElementById("copy-status");
                  if (!button || !code || !status) return;
                  button.addEventListener("click", async () => {
                    try {
                      await navigator.clipboard.writeText((code.textContent || "").trim());
                      status.textContent = "One-time pass copied. Continue to Microsoft sign-in.";
                    } catch {
                      status.textContent = "Copy failed. Select the pass above and copy it manually.";
                    }
                  });
                })();
                """,
                "application/javascript; charset=utf-8");
        }).AllowAnonymous();

        app.MapGet("/online-kiosk/kiosk-reset.js", (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store, max-age=0";
            return Results.Text(
                """
                (() => {
                  const button = document.getElementById("reset-kiosk");
                  if (!button) return;
                  button.addEventListener("click", async () => {
                    button.disabled = true;
                    button.textContent = "Resetting OnlineKiosk…";
                    try { await navigator.clipboard.writeText(""); } catch {}
                    window.location.replace("/online-kiosk");
                  });
                })();
                """,
                "application/javascript; charset=utf-8");
        }).AllowAnonymous();

        app.MapGet("/online-kiosk", (HttpContext context, IAntiforgery antiforgery) =>
        {
            if (!Enabled(cfg)) return DisabledPage(cfg);
            string token = antiforgery.GetAndStoreTokens(context).RequestToken ?? "";
            return Page(
                "OnlineKiosk",
                $"""
                <section class="card">
                  <p class="eyebrow">REGULAR STUDENT ONLINE PASSWORD RESET</p>
                  <h1>OnlineKiosk</h1>
                  <p class="lead">Reset your SCCC password and receive a one-use Microsoft Temporary Access Pass. This online service permits one successful password change every 30 days.</p>
                  <form method="post" action="/online-kiosk/find">
                    <input type="hidden" name="__RequestVerificationToken" value="{H(token)}">
                    <div class="grid">
                      <label>Legal first name<input name="firstName" autocomplete="given-name" required maxlength="80"></label>
                      <label>Legal last name<input name="lastName" autocomplete="family-name" required maxlength="80"></label>
                    </div>
                    <label>Student 800 number<input name="studentId" inputmode="numeric" autocomplete="off" required maxlength="9" pattern="800[0-9][0-9][0-9][0-9][0-9][0-9]" placeholder="800123456"></label>
                    <label>SCCC username<input name="username" autocomplete="username" required maxlength="80" placeholder="first.last"></label>
                    <button>Verify my student account</button>
                  </form>
                  <aside>A security notice will be sent to your official <b>@g.sccc.edu</b> address after a successful password change. Passwords and one-time passes are never emailed.</aside>
                  <p class="separate"><b>High-school MFA access:</b> use <a href="{H(HighSchoolAccessUrl(cfg))}">High School Student Access</a> only for the high-school MFA workflow. High-school students may also use OnlineKiosk for password resets.</p>
                </section>
                """,
                cfg);
        }).AllowAnonymous();

        app.MapPost("/online-kiosk/find", async (
            HttpContext context,
            IAntiforgery antiforgery,
            OnlineIdentityService identities,
            GraphService graph,
            OnlineResetGuard guard,
            AuditStore audit) =>
        {
            if (!Enabled(cfg)) return DisabledPage(cfg);
            try
            {
                await antiforgery.ValidateRequestAsync(context);
            }
            catch (AntiforgeryValidationException)
            {
                return ErrorPage("Session expired", "Please start the OnlineKiosk again. No account was changed.", 400, cfg);
            }

            IFormCollection form = await context.Request.ReadFormAsync();
            string first = form["firstName"].ToString().Trim();
            string last = form["lastName"].ToString().Trim();
            string studentId = Digits(form["studentId"].ToString());
            string? username = NormalizeUsername(form["username"].ToString());
            string ip = Ip(context);
            const string actor = "online-kiosk:self-service";

            bool studentAllowed = identities.AllowAttempt("online-kiosk:student:" + studentId, 5, 15);
            bool ipAllowed = identities.AllowAttempt("online-kiosk:ip:" + ip, 30, 15);
            if (!studentAllowed || !ipAllowed || username is null)
            {
                await audit.Write("online-kiosk-lookup", "denied", actor, "unknown", ip, null, "Lookup rate limit or invalid input", null);
                return ErrorPage("Unable to verify", "The information could not be verified or the attempt limit was reached. Wait 15 minutes or contact SCCC IT.", 429, cfg);
            }

            Eligibility? nameMatch = await graph.FindRegularStudentByIdentity(first, last, studentId);
            Eligibility? usernameMatch = await graph.FindRegularStudent(username, studentId);

            if (nameMatch is null || usernameMatch is null || !FixedEquals(nameMatch.Id, usernameMatch.Id))
            {
                await audit.Write("online-kiosk-lookup", "denied", actor, "unknown", ip, null, "No unique active regular-student match", null);
                return ErrorPage("Unable to verify", "Check your exact legal name, SCCC username, and all nine digits of your 800 number.", 400, cfg);
            }

            if (!await graph.IsOnlineKioskStudentAccount(nameMatch.Id))
            {
                await audit.Write("online-kiosk-lookup", "denied", actor, nameMatch.Id, ip, null, "Account is not an active SCCC student account", null);
                return ErrorPage("Unable to verify", "This account could not be confirmed as an active SCCC student account. No account was changed. Contact SCCC IT if you believe this is incorrect.", 403, cfg);
            }

            DateTimeOffset? nextEligible = await NextBlockedUtc(guard, audit, nameMatch.Id);
            if (nextEligible is not null)
            {
                await audit.Write("online-kiosk-reset", "denied", actor, nameMatch.Id, ip, null, "A successful OnlineKiosk password change exists within 30 days", null);
                return LimitPage(nextEligible.Value, cfg);
            }

            string? notificationEmail = await graph.GetStudentNotificationEmail(nameMatch.Id);
            if (notificationEmail is null)
            {
                await audit.Write("online-kiosk-lookup", "denied", actor, nameMatch.Id, ip, null, "No approved @g.sccc.edu notification address", null);
                return ErrorPage("Email verification unavailable", "Your official @g.sccc.edu notification address could not be confirmed. No account was changed. Contact SCCC IT.", 409, cfg);
            }

            string grant = identities.CreateGrant(
                nameMatch.Id,
                nameMatch.Upn,
                nameMatch.DisplayName,
                nameMatch.StudentId,
                minutes: 10);
            string requestToken = antiforgery.GetAndStoreTokens(context).RequestToken ?? "";
            await audit.Write("online-kiosk-lookup", "success", actor, nameMatch.Id, ip, null, "Identity matched for OnlineKiosk", null);
            return ConfirmationPage(nameMatch, grant, requestToken, notificationEmail, cfg);
        }).AllowAnonymous();

        app.MapPost("/online-kiosk/issue", async (
            HttpContext context,
            IAntiforgery antiforgery,
            OnlineIdentityService identities,
            GraphService graph,
            OnlineResetGuard guard,
            AuditStore audit,
            ReportMailService mail,
            PasswordResetActivityReporter activityReporter) =>
        {
            if (!Enabled(cfg)) return DisabledPage(cfg);
            try
            {
                await antiforgery.ValidateRequestAsync(context);
            }
            catch (AntiforgeryValidationException)
            {
                return ErrorPage("Session expired", "Please start the OnlineKiosk again. No account was changed.", 400, cfg);
            }

            IFormCollection form = await context.Request.ReadFormAsync();
            string newPassword = form["newPassword"].ToString();
            string confirmation = form["confirmPassword"].ToString();
            string? passwordError = !string.Equals(form["confirm"].ToString(), "yes", StringComparison.Ordinal)
                ? "Confirm that you are changing only your own account."
                : PasswordError(newPassword, confirmation);
            if (passwordError is not null)
            {
                KioskGrant? retry = identities.GetGrant(form["grant"].ToString());
                if (retry is null)
                    return ErrorPage("Session expired", "Please start the OnlineKiosk again. No account was changed.", 400, cfg);
                string notification = await graph.GetStudentNotificationEmail(retry.ObjectId) ?? "your @g.sccc.edu mailbox";
                string requestToken = antiforgery.GetAndStoreTokens(context).RequestToken ?? "";
                return ConfirmationPage(
                    new Eligibility(true, retry.ObjectId, retry.DisplayName, retry.Upn, null, null),
                    form["grant"].ToString(),
                    requestToken,
                    notification,
                    cfg,
                    passwordError,
                    400);
            }

            KioskGrant? grant = identities.TakeGrant(form["grant"].ToString());
            if (grant is null)
                return ErrorPage("Session expired", "Please start the OnlineKiosk again. No account was changed.", 400, cfg);

            string ip = Ip(context);
            string actor = grant.Actor;
            if (!await graph.IsOnlineKioskStudentAccount(grant.ObjectId))
            {
                await audit.Write("online-kiosk-reset", "denied", actor, grant.ObjectId, ip, null, "Account is no longer an active SCCC student account", null);
                return ErrorPage("OnlineKiosk unavailable", "This account could not be confirmed as an active SCCC student account. No account was changed.", 403, cfg);
            }

            string? notificationEmail = await graph.GetStudentNotificationEmail(grant.ObjectId);
            if (notificationEmail is null)
            {
                await audit.Write("online-kiosk-reset", "denied", actor, grant.ObjectId, ip, null, "No approved @g.sccc.edu notification address", null);
                return ErrorPage("Email verification unavailable", "Your official @g.sccc.edu notification address could not be confirmed. No account was changed. Contact SCCC IT.", 409, cfg);
            }

            DateTimeOffset? blockedUntil = grant.Assisted
                ? null
                : await NextBlockedUtc(guard, audit, grant.ObjectId);
            if (blockedUntil is not null)
            {
                await audit.Write("online-kiosk-reset", "denied", actor, grant.ObjectId, ip, null, "A successful OnlineKiosk password change exists within 30 days", null);
                return LimitPage(blockedUntil.Value, cfg);
            }

            OnlineResetGuard.OnlineResetLease? lease;
            try
            {
                lease = await guard.TryBegin(
                    grant.ObjectId,
                    ResetWindow,
                    bypassUsedWindow: grant.Assisted);
            }
            catch (Exception ex)
            {
                await audit.Write("online-kiosk-reset", "failed", actor, grant.ObjectId, ip, null, "Reset ledger unavailable: " + ex.Message, null);
                return ErrorPage("OnlineKiosk unavailable", "The one-time-use record could not be verified. No account was changed. Contact SCCC IT.", 503, cfg);
            }

            if (lease is null)
            {
                DateTimeOffset next = await guard.NextEligibleUtc(grant.ObjectId, ResetWindow) ?? DateTimeOffset.UtcNow.AddMinutes(15);
                await audit.Write("online-kiosk-reset", "denied", actor, grant.ObjectId, ip, null, "OnlineKiosk reset is already used or in progress", null);
                return LimitPage(next, cfg);
            }

            await using (lease)
            {
                bool passwordChanged = false;
                try
                {
                    await graph.SetPassword(grant.ObjectId, newPassword);
                    passwordChanged = true;
                    await lease.Complete();
                    await audit.Write(
                        "online-kiosk-reset",
                        "success",
                        actor,
                        grant.ObjectId,
                        ip,
                        null,
                        grant.Assisted
                            ? "Authorized assisted password changed; 30-day self-service limit recorded"
                            : "OnlineKiosk password changed; 30-day limit recorded",
                        null);
                }
                catch (GraphRequestException ex)
                {
                    await audit.Write("online-kiosk-reset", "failed", actor, grant.ObjectId, ip, null, ex.SafeMessage, ex.RequestId);
                    return ErrorPage("Password not changed", "Microsoft Entra could not change the password. No OnlineKiosk use was consumed. Contact SCCC IT and provide request ID " + (ex.RequestId ?? "not provided") + ".", 502, cfg);
                }
                catch (Exception ex)
                {
                    if (passwordChanged)
                    {
                        try
                        {
                            await audit.Write("online-kiosk-reset", "success", actor, grant.ObjectId, ip, null, "Password changed, but the 30-day ledger or audit finalization failed: " + ex.Message, null);
                        }
                        catch (Exception auditError)
                        {
                            Console.Error.WriteLine("OnlineKiosk critical audit failure for {0}: {1}", grant.ObjectId, auditError.Message);
                        }
                        return ErrorPage("Password changed — contact IT", "Your password was changed, but OnlineKiosk could not safely finish the one-time-use record. Do not repeat the request. Contact SCCC IT now.", 503, cfg);
                    }

                    await audit.Write("online-kiosk-reset", "failed", actor, grant.ObjectId, ip, null, ex.Message, null);
                    return ErrorPage("Password not changed", "OnlineKiosk could not change the password. Contact SCCC IT.", 503, cfg);
                }
            }

            try
            {
                bool reported = await activityReporter.QueueAndTrySend(
                    grant.Upn,
                    ip,
                    DateTimeOffset.UtcNow,
                    CancellationToken.None);
                await audit.Write(
                    "online-kiosk-activity-report",
                    reported ? "success" : "pending",
                    actor,
                    grant.ObjectId,
                    ip,
                    null,
                    reported
                        ? "Password-reset activity recorded by the central report"
                        : "Password-reset activity queued for central report retry",
                    null);
            }
            catch (Exception ex)
            {
                await audit.Write(
                    "online-kiosk-activity-report",
                    "failed",
                    actor,
                    grant.ObjectId,
                    ip,
                    null,
                    "Password-reset activity could not be queued: " + ex.Message,
                    null);
            }

            TapResult? tap = null;
            GraphRequestException? tapError = null;
            try
            {
                tap = await graph.CreateTap(grant.ObjectId);
                await audit.Write("online-kiosk-tap-issued", "success", actor, grant.ObjectId, ip, null, "One-use TAP issued after OnlineKiosk password change", tap.CorrelationId);
            }
            catch (GraphRequestException ex)
            {
                tapError = ex;
                await audit.Write("online-kiosk-tap-issued", "failed", actor, grant.ObjectId, ip, null, ex.SafeMessage, ex.RequestId);
            }

            bool notificationSent = false;
            try
            {
                await mail.SendStudentPasswordResetNotification(notificationEmail, grant.DisplayName, DateTimeOffset.UtcNow, ip);
                notificationSent = true;
                await audit.Write("online-kiosk-notification", "success", actor, grant.ObjectId, ip, null, "Security notification sent to authoritative @g.sccc.edu address", null);
            }
            catch (Exception ex)
            {
                await audit.Write("online-kiosk-notification", "failed", actor, grant.ObjectId, ip, null, ex.Message, null);
            }

            if (tap is null)
            {
                return Page(
                    "Password changed",
                    $"""
                    <section class="card">
                      <p class="eyebrow">PASSWORD CHANGED</p><h1>Your password was changed</h1>
                      <p>The one-use Microsoft pass could not be issued. Your OnlineKiosk use has been recorded for 30 days.</p>
                      <p>{(notificationSent ? "A security notice was sent to your official @g.sccc.edu mailbox." : "The security email could not be delivered; SCCC IT has a failure record.")}</p>
                      <p>Contact SCCC IT and provide request ID <code>{H(tapError?.RequestId ?? "not provided")}</code>.</p>
                      <button id="reset-kiosk" type="button">Finish and start next student</button>
                    </section>
                    <script src="/online-kiosk/kiosk-reset.js" defer></script>
                    """,
                    cfg,
                    502);
            }

            string signInUrl = cfg["STUDENT_SIGNIN_URL"] ?? "https://experience.elluciancloud.com/scccats/";
            return Page(
                "OnlineKiosk complete",
                $"""
                <section class="card tap" data-private>
                  <p class="eyebrow">PASSWORD CHANGED · ONE-USE MICROSOFT PASS</p>
                  <h1>Copy your one-time pass</h1>
                  <p>Your OnlineKiosk password change is complete. Another online change is not available for 30 days.</p>
                  <div id="tap-code" class="code">{H(tap.Code)}</div>
                  <p>Expires <strong>{tap.ExpiresUtc.LocalDateTime:t}</strong> and can be used once.</p>
                  <div class="actions"><button id="copy-pass" type="button">Copy one-time pass</button><a class="button secondary" href="{H(signInUrl)}" target="_blank" rel="noopener">Continue to Microsoft sign-in</a></div>
                  <p id="copy-status" class="status" role="status" aria-live="polite">Copy the pass, then choose Temporary Access Pass at Microsoft sign-in.</p>
                  <p>{(notificationSent ? "A security notice was sent to your official @g.sccc.edu mailbox." : "The security email could not be delivered; SCCC IT has a failure record.")}</p>
                  <aside>Do not email, photograph, or share the password or Temporary Access Pass.</aside>
                  <button id="reset-kiosk" type="button">Finish and start next student</button>
                </section>
                <script src="/tap-copy.js" defer></script>
                <script src="/online-kiosk/kiosk-reset.js" defer></script>
                """,
                cfg);
        }).AllowAnonymous();
    }

    internal static IResult ConfirmationPage(
        Eligibility student,
        string grant,
        string requestToken,
        string notificationEmail,
        IConfiguration cfg,
        string? error = null,
        int status = 200)
    {
        string errorHtml = string.IsNullOrWhiteSpace(error) ? "" : $"<p class='error'>{H(error)}</p>";
        return Page(
            "Confirm OnlineKiosk reset",
            $"""
            <section class="card">
              <p class="eyebrow">CONFIRM YOUR ACCOUNT</p><h1>{H(student.DisplayName)}</h1>
              <p class="lead">SCCC account: <b>{H(student.Upn)}</b></p>
              <p>A security notice will be sent to <b>{H(MaskEmail(notificationEmail))}</b>.</p>
              {errorHtml}
              <form method="post" action="/online-kiosk/issue">
                <input type="hidden" name="__RequestVerificationToken" value="{H(requestToken)}">
                <input type="hidden" name="grant" value="{H(grant)}">
                <label>New password<input type="password" name="newPassword" autocomplete="new-password" required minlength="8" maxlength="256"></label>
                <label>Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" required minlength="8" maxlength="256"></label>
                <p>Use at least eight characters and at least one special character.</p>
                <label class="check"><input type="checkbox" name="confirm" value="yes" required> I am changing only my own account.</label>
                <button>Change password and issue one-time pass</button>
              </form>
              <a class="button secondary" href="/online-kiosk">Not my account</a>
            </section>
            """,
            cfg,
            status);
    }

    private static IResult LimitPage(DateTimeOffset nextEligibleUtc, IConfiguration cfg)
    {
        DateTimeOffset local = TimeZoneInfo.ConvertTime(nextEligibleUtc, CentralTime());
        return Page(
            "OnlineKiosk limit reached",
            $"""
            <section class="card">
              <h1>Online reset already used</h1>
              <p>OnlineKiosk permits one successful password change in a rolling 30-day period.</p>
              <p>The next online change is available after <b>{H(local.ToString("MMMM d, yyyy 'at' h:mm tt"))} Central Time</b>.</p>
              <p>If access is still unavailable, contact SCCC IT for an audited administrator-assisted reset.</p>
              <a class="button" href="mailto:itech@sccc.edu">Email SCCC IT</a>
            </section>
            """,
            cfg,
            429);
    }

    private static async Task<DateTimeOffset?> NextBlockedUtc(
        OnlineResetGuard guard,
        AuditStore audit,
        string objectId)
    {
        DateTimeOffset? ledgerValue = await guard.NextEligibleUtc(objectId, ResetWindow);
        if (ledgerValue is not null) return ledgerValue;

        AuditRow? latestAudit = (await audit.Recent(10000)).FirstOrDefault(row =>
            row.Type == "online-kiosk-reset"
            && row.Result == "success"
            && string.Equals(row.Target, objectId, StringComparison.OrdinalIgnoreCase)
            && row.Utc >= DateTimeOffset.UtcNow.Subtract(ResetWindow));
        if (latestAudit is null) return null;

        DateTimeOffset next = latestAudit.Utc.Add(ResetWindow);
        return next > DateTimeOffset.UtcNow ? next : null;
    }

    internal static bool Enabled(IConfiguration cfg) =>
        string.Equals(cfg["ONLINE_KIOSK_ENABLED"], "true", StringComparison.OrdinalIgnoreCase);

    private static string HighSchoolAccessUrl(IConfiguration cfg) =>
        cfg["HS_ACCESS_URL"]
        ?? "https://app-server2.centralus.cloudapp.azure.com:8443/student-start";

    private static IResult DisabledPage(IConfiguration cfg) =>
        Page(
            "OnlineKiosk unavailable",
            "<section class='card'><h1>OnlineKiosk is temporarily unavailable</h1><p>No account was changed. Contact SCCC IT for assistance.</p><a class='button' href='mailto:itech@sccc.edu'>Email SCCC IT</a></section>",
            cfg,
            503);

    internal static IResult ErrorPage(string title, string message, int status, IConfiguration cfg) =>
        Page(
            title,
            $"<section class='card'><h1>{H(title)}</h1><p>{H(message)}</p><div class='actions'><a class='button secondary' href='/online-kiosk'>Start over</a><a class='button' href='mailto:itech@sccc.edu'>Email SCCC IT</a></div></section>",
            cfg,
            status);

    private static string? PasswordError(string password, string confirmation)
    {
        if (password.Length < 8) return "The password must contain at least eight characters.";
        if (password.Length > 256) return "The password is too long.";
        if (!password.Any(ch => !char.IsLetterOrDigit(ch))) return "The password must contain at least one special character.";
        if (!FixedEquals(password, confirmation)) return "The two password entries do not match.";
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

    private static bool FixedEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(a.Trim().ToUpperInvariant())),
            SHA256.HashData(Encoding.UTF8.GetBytes(b.Trim().ToUpperInvariant())));

    private static string MaskEmail(string address)
    {
        int at = address.IndexOf('@');
        if (at <= 1) return "***@g.sccc.edu";
        return address[0] + new string('•', Math.Min(6, at - 1)) + address[at..];
    }

    private static string Digits(string? value) => new((value ?? "").Where(char.IsDigit).ToArray());
    private static string Ip(HttpContext context) => context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    private static string H(string? value) => HtmlEncoder.Default.Encode(value ?? "");

    private static TimeZoneInfo CentralTime()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("America/Chicago"); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.FindSystemTimeZoneById("Central Standard Time"); }
    }

    private static IResult Page(string title, string body, IConfiguration cfg, int status = 200)
    {
        string phone = cfg["SUPPORT_PHONE"] ?? "620-417-1200";
        string html = $"""
        <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>{H(title)} · SCCC</title><style>{Css}</style></head><body>
        <header><a href="/online-kiosk"><b>SCCC</b><span>OnlineKiosk</span></a><a href="mailto:itech@sccc.edu">itech@sccc.edu</a></header>
        <main>{body}</main>
        <a class="support" href="tel:{H(phone)}">☎ Call IT Support<br><small>{H(phone)}</small></a>
        <footer>Seward County Community College · SCCC IT</footer></body></html>
        """;
        return new HtmlPageResult(html, status, noStore: true);
    }

    private const string Css = """
    :root{--forest:#123d2d;--deep:#071b14;--green:#08794f;--bright:#73d39a;--ink:#f3fff8;--muted:#c7ddd1;--line:#ffffff2d}*{box-sizing:border-box}html{font-size:18px}body{margin:0;min-height:100vh;background:radial-gradient(circle at 82% 8%,#236448 0,#123d2d 38%,#071b14 100%);color:var(--ink);font:20px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column}header{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:20px clamp(22px,5vw,80px);background:#071b14ee;border-bottom:1px solid var(--line)}header a{color:white;text-decoration:none;font-weight:750}header a:first-child{display:flex;align-items:center;gap:18px}header b{font-size:30px;color:var(--bright)}header span{border-left:1px solid #ffffff55;padding-left:18px;font-size:22px}main{width:min(100%,1100px);margin:0 auto;padding:clamp(34px,6vw,76px) 22px;flex:1}.card{background:#123b2ef2;border:1px solid #ffffff35;border-radius:22px;padding:clamp(28px,5vw,58px);box-shadow:0 28px 90px #0008}.card h1{font-size:clamp(42px,6vw,68px);line-height:1.05;margin:.2em 0}.lead{font-size:clamp(20px,2vw,26px);color:var(--muted)}.eyebrow{letter-spacing:.14em;color:var(--bright);font-size:15px;font-weight:850}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}label{display:block;margin:24px 0 12px;font-weight:750}input{display:block;width:100%;margin-top:9px;padding:16px 18px;border-radius:11px;border:2px solid #ffffff44;background:#071f17;color:white;font:19px system-ui;min-height:58px}.check{display:flex;gap:12px;align-items:center}.check input{width:24px;height:24px;margin:0;min-height:0}.button,button{display:inline-block;margin-top:18px;background:linear-gradient(135deg,var(--green),#149260);border:0;border-radius:12px;color:white;padding:16px 26px;font:800 19px system-ui;text-decoration:none;cursor:pointer}.secondary{background:#ffffff14;border:1px solid #ffffff44;margin-left:10px}.actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center}.actions .secondary{margin-left:0}aside,.separate{margin-top:28px;padding:18px 20px;background:#73d39a16;border-left:4px solid var(--bright);border-radius:8px}.error{padding:14px 17px;background:#871f2b55;border:1px solid #ff9ca7;border-radius:8px}.tap{text-align:center}.code{font:800 clamp(42px,7vw,74px) ui-monospace;letter-spacing:.1em;background:#03120d;padding:34px 20px;margin:28px 0;border:2px solid #73d39a55;border-radius:15px;color:#aaf1c5;overflow-wrap:anywhere}.status{color:var(--bright);font-weight:750}.support{position:fixed;right:24px;bottom:24px;background:#08794f;color:white;padding:14px 20px;border-radius:50px;text-decoration:none;box-shadow:0 8px 30px #0008;font-size:17px}footer{text-align:center;color:#9fc5ae;padding:28px;font-size:16px}a{color:#9ceab8}@media(max-width:700px){.grid{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}.support{position:static;margin:18px}.button,button{width:100%;text-align:center}.secondary{margin-left:0}}
    """;
}
