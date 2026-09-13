using System.Net;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.HttpOverrides;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddEnvironmentVariables();
builder.WebHost.UseUrls(builder.Configuration["ASPNETCORE_URLS"] ?? "http://127.0.0.1:8091");

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 2;
    options.KnownProxies.Add(IPAddress.Loopback);
    options.KnownProxies.Add(IPAddress.IPv6Loopback);
    options.KnownProxies.Add(IPAddress.Parse("10.0.0.44"));
});
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "__Host-ScccOnlineKioskCsrf";
    options.Cookie.HttpOnly = true;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    options.Cookie.SameSite = SameSiteMode.Lax;
});
builder.Services.AddHttpClient();
builder.Services.AddSingleton<AuditStore>();
builder.Services.AddSingleton<GraphService>();
builder.Services.AddSingleton<OnlineIdentityService>();
builder.Services.AddSingleton<OnlineResetGuard>();
builder.Services.AddSingleton<AdminRecoverySecurity>();
builder.Services.AddSingleton<ReportMailService>();
builder.Services.AddSingleton<PasswordResetActivityReporter>();
builder.Services.AddHostedService(services => services.GetRequiredService<PasswordResetActivityReporter>());

WebApplication app = builder.Build();
app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    context.Response.Headers.ContentSecurityPolicy =
        "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers.XFrameOptions = "DENY";
    context.Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    await next();
});

app.MapGet("/", () => Results.Redirect("/online-kiosk")).AllowAnonymous();
app.MapGet("/health", () => Results.Json(new
{
    status = "healthy",
    application = "SCCC OnlineKiosk",
    version = "2026-09-13.1",
    internalOnly = true,
    utc = DateTimeOffset.UtcNow,
})).AllowAnonymous();
app.MapOnlineKiosk(builder.Configuration);
app.MapAdminRecovery(builder.Configuration);

app.Run();
