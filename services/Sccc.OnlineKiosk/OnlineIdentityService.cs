using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Security.Cryptography;

internal sealed record KioskGrant(
    string ObjectId,
    string Upn,
    string DisplayName,
    string? StudentId,
    string Actor,
    bool Assisted,
    DateTimeOffset ExpiresUtc);

internal sealed class OnlineIdentityService
{
    private readonly ConcurrentDictionary<string, KioskGrant> grants = new();
    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> attempts = new();

    public bool AllowAttempt(string key, int limit = 5, int windowMinutes = 15)
    {
        limit = Math.Clamp(limit, 1, 1000);
        windowMinutes = Math.Clamp(windowMinutes, 1, 1440);
        DateTimeOffset now = DateTimeOffset.UtcNow;
        Queue<DateTimeOffset> queue = attempts.GetOrAdd(key, _ => new Queue<DateTimeOffset>());
        lock (queue)
        {
            while (queue.Count > 0 && queue.Peek() < now.AddMinutes(-windowMinutes)) queue.Dequeue();
            if (queue.Count >= limit) return false;
            queue.Enqueue(now);
            return true;
        }
    }

    public string CreateGrant(
        string objectId,
        string upn,
        string displayName,
        string? studentId = null,
        string actor = "online-kiosk:self-service",
        bool assisted = false,
        int minutes = 10)
    {
        Cleanup();
        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        grants[token] = new KioskGrant(
            objectId,
            upn,
            displayName,
            studentId,
            actor,
            assisted,
            DateTimeOffset.UtcNow.AddMinutes(Math.Clamp(minutes, 1, 60)));
        return token;
    }

    public KioskGrant? GetGrant(string token)
    {
        Cleanup();
        return grants.TryGetValue(token, out KioskGrant? grant)
            && grant.ExpiresUtc > DateTimeOffset.UtcNow
            ? grant
            : null;
    }

    public KioskGrant? TakeGrant(string token)
    {
        Cleanup();
        return grants.TryRemove(token, out KioskGrant? grant)
            && grant.ExpiresUtc > DateTimeOffset.UtcNow
            ? grant
            : null;
    }

    private void Cleanup()
    {
        foreach ((string token, KioskGrant grant) in grants)
            if (grant.ExpiresUtc <= DateTimeOffset.UtcNow) grants.TryRemove(token, out _);
    }
}
