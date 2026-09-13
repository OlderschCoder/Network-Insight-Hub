using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

internal sealed class AuditStore
{
	private readonly SemaphoreSlim gate = new SemaphoreSlim(1, 1);

	private readonly string path;

	public AuditStore(IConfiguration cfg)
	{
		path = cfg["AUDIT_PATH"] ?? Path.Combine(AppContext.BaseDirectory, "data", "audit.jsonl");
	}

	public async Task Write(string type, string result, string actor, string target, string ip, string? school, string? reason, string? correlation)
	{
		AuditRow row = new AuditRow(DateTimeOffset.UtcNow, type, result, actor, target, ip, school, reason, correlation);
		await gate.WaitAsync();
		try
		{
			Directory.CreateDirectory(Path.GetDirectoryName(path));
			await File.AppendAllTextAsync(path, JsonSerializer.Serialize(row) + Environment.NewLine);
		}
		finally
		{
			gate.Release();
		}
	}

	public async Task<List<AuditRow>> Recent(int take)
	{
		if (!File.Exists(path))
		{
			return new List<AuditRow>();
		}
		await gate.WaitAsync();
		try
		{
			return (from x in (await File.ReadAllLinesAsync(path)).TakeLast(take)
				select JsonSerializer.Deserialize<AuditRow>(x) into x
				where x != null
				select x).Cast<AuditRow>().Reverse().ToList();
		}
		finally
		{
			gate.Release();
		}
	}

	public async Task<int> CountSince(string type, string id, bool target, DateTimeOffset since)
	{
		return (await Recent(10000)).Count((AuditRow x) => x.Type == type && x.Utc >= since && (target ? x.Target : x.Actor) == id && x.Result == "success");
	}

	public async Task<List<AuditRow>> Between(DateTimeOffset startUtc, DateTimeOffset endUtc, params string[] types)
	{
		if (!File.Exists(path))
		{
			return new List<AuditRow>();
		}
		HashSet<string> allowed = new HashSet<string>(types ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase);
		await gate.WaitAsync();
		try
		{
			List<AuditRow> rows = new List<AuditRow>();
			foreach (string line in await File.ReadAllLinesAsync(path))
			{
				if (string.IsNullOrWhiteSpace(line)) continue;
				try
				{
					AuditRow? row = JsonSerializer.Deserialize<AuditRow>(line);
					if (row != null && row.Utc >= startUtc && row.Utc < endUtc && (allowed.Count == 0 || allowed.Contains(row.Type))) rows.Add(row);
				}
				catch (JsonException)
				{
					// Preserve reporting even if one historical audit line is malformed.
				}
			}
			return rows.OrderBy(x => x.Utc).ToList();
		}
		finally
		{
			gate.Release();
		}
	}
}
