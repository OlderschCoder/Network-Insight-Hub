using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

internal sealed record OnlineResetLedgerEntry(
    DateTimeOffset? UsedUtc,
    string? ReservationId,
    DateTimeOffset? ReservedUntilUtc);

internal sealed class OnlineResetGuard
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly string path;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    public OnlineResetGuard(IConfiguration cfg)
    {
        path = cfg["ONLINE_RESET_LEDGER_PATH"]
            ?? "/var/lib/sccc-mfa/online-password-reset-ledger.json";
    }

    public async Task<DateTimeOffset?> NextEligibleUtc(string objectId, TimeSpan window)
    {
        await gate.WaitAsync();
        try
        {
            Dictionary<string, OnlineResetLedgerEntry> ledger = await Load();
            string key = Normalize(objectId);
            if (!ledger.TryGetValue(key, out OnlineResetLedgerEntry? entry) || entry.UsedUtc is null)
                return null;

            DateTimeOffset next = entry.UsedUtc.Value.Add(window);
            return next > DateTimeOffset.UtcNow ? next : null;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<OnlineResetLease?> TryBegin(
        string objectId,
        TimeSpan window,
        bool bypassUsedWindow = false)
    {
        await gate.WaitAsync();
        try
        {
            Dictionary<string, OnlineResetLedgerEntry> ledger = await Load();
            string key = Normalize(objectId);
            DateTimeOffset now = DateTimeOffset.UtcNow;
            ledger.TryGetValue(key, out OnlineResetLedgerEntry? existing);

            if (!bypassUsedWindow
                && existing?.UsedUtc is DateTimeOffset used
                && used.Add(window) > now)
                return null;
            if (existing?.ReservedUntilUtc is DateTimeOffset reserved && reserved > now)
                return null;

            string reservationId = Guid.NewGuid().ToString("N");
            ledger[key] = new OnlineResetLedgerEntry(existing?.UsedUtc, reservationId, now.AddMinutes(15));
            await Save(ledger);
            return new OnlineResetLease(this, key, reservationId);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task Complete(string key, string reservationId)
    {
        await gate.WaitAsync();
        try
        {
            Dictionary<string, OnlineResetLedgerEntry> ledger = await Load();
            if (!ledger.TryGetValue(key, out OnlineResetLedgerEntry? entry)
                || !string.Equals(entry.ReservationId, reservationId, StringComparison.Ordinal))
                throw new InvalidOperationException("The online reset reservation is no longer valid.");

            ledger[key] = new OnlineResetLedgerEntry(DateTimeOffset.UtcNow, null, null);
            await Save(ledger);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task Release(string key, string reservationId)
    {
        await gate.WaitAsync();
        try
        {
            Dictionary<string, OnlineResetLedgerEntry> ledger = await Load();
            if (ledger.TryGetValue(key, out OnlineResetLedgerEntry? entry)
                && string.Equals(entry.ReservationId, reservationId, StringComparison.Ordinal))
            {
                if (entry.UsedUtc is null)
                    ledger.Remove(key);
                else
                    ledger[key] = new OnlineResetLedgerEntry(entry.UsedUtc, null, null);
                await Save(ledger);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<Dictionary<string, OnlineResetLedgerEntry>> Load()
    {
        if (!File.Exists(path))
            return new Dictionary<string, OnlineResetLedgerEntry>(StringComparer.OrdinalIgnoreCase);

        string json = await File.ReadAllTextAsync(path);
        Dictionary<string, OnlineResetLedgerEntry>? stored =
            JsonSerializer.Deserialize<Dictionary<string, OnlineResetLedgerEntry>>(json, JsonOptions);
        if (stored is null)
            throw new InvalidDataException("The online password-reset ledger is invalid.");
        return new Dictionary<string, OnlineResetLedgerEntry>(stored, StringComparer.OrdinalIgnoreCase);
    }

    private async Task Save(Dictionary<string, OnlineResetLedgerEntry> ledger)
    {
        string? directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
        string temporary = path + ".tmp";
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(ledger, JsonOptions));
        File.Move(temporary, path, true);
    }

    private static string Normalize(string objectId) => objectId.Trim().ToLowerInvariant();

    internal sealed class OnlineResetLease : IAsyncDisposable
    {
        private readonly OnlineResetGuard owner;
        private readonly string key;
        private readonly string reservationId;
        private bool completed;
        private bool disposed;

        internal OnlineResetLease(OnlineResetGuard owner, string key, string reservationId)
        {
            this.owner = owner;
            this.key = key;
            this.reservationId = reservationId;
        }

        public async Task Complete()
        {
            if (completed) return;
            await owner.Complete(key, reservationId);
            completed = true;
        }

        public async ValueTask DisposeAsync()
        {
            if (disposed) return;
            disposed = true;
            if (!completed) await owner.Release(key, reservationId);
        }
    }
}
