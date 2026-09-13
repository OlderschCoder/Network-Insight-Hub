using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

internal sealed record Eligibility(bool Eligible, string Id, string DisplayName, string Upn, string? StudentId, string? School);
internal sealed record TapResult(string Code, DateTimeOffset ExpiresUtc, string? CorrelationId);
internal sealed record AuditRow(DateTimeOffset Utc, string Type, string Result, string Actor, string Target, string Ip, string? School, string? Reason, string? CorrelationId);
internal sealed record EupStudent(DateTimeOffset CreatedUtc, string DisplayName, string StudentId, string UserPrincipalName, string Mail, string Status, bool Valid);

internal sealed class GraphRequestException : Exception
{
    public int StatusCode { get; }
    public string SafeMessage { get; }
    public string? RequestId { get; }
    public GraphRequestException(int statusCode, string safeMessage, string? requestId) : base(safeMessage)
    {
        StatusCode = statusCode; SafeMessage = safeMessage; RequestId = requestId;
    }
}

internal sealed class HtmlPageResult : IResult
{
    private readonly string html;
    private readonly int status;
    private readonly bool noStore;
    public HtmlPageResult(string html, int status, bool noStore) { this.html = html; this.status = status; this.noStore = noStore; }
    public async Task ExecuteAsync(HttpContext context)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "text/html; charset=utf-8";
        if (noStore) context.Response.Headers.CacheControl = "no-store, max-age=0";
        await context.Response.WriteAsync(html);
    }
}
