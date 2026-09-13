using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

internal sealed record MfaRegistrationStatus(bool HasMobilePhone, bool HasMicrosoftAuthenticator);

internal sealed class GraphService
{
	private readonly HttpClient http;

	private readonly IConfiguration cfg;

	private readonly ConcurrentDictionary<string, (string Token, DateTimeOffset Expires)> tokens;

	private readonly Dictionary<string, string> schoolLookup;

	private readonly ConcurrentDictionary<string, SemaphoreSlim> tapLocks = new();

	public GraphService(IHttpClientFactory factory, IConfiguration cfg)
	{
		this.cfg = cfg;
		http = factory.CreateClient();
		tokens = new ConcurrentDictionary<string, (string, DateTimeOffset)>();
		schoolLookup = LoadSchoolLookup(cfg["STUDENT_SCHOOL_MAP_PATH"]);
	}

	private async Task<string> Token()
	{
		if (tokens.TryGetValue("graph", out (string, DateTimeOffset) value) && value.Item2 > DateTimeOffset.UtcNow.AddMinutes(5.0))
		{
			return value.Item1;
		}
		string text = cfg["GRAPH_ACCESS_TOKEN"];
		if (!string.IsNullOrWhiteSpace(text))
		{
			return text;
		}
		string text2 = cfg["ENTRA_TENANT_ID"];
		string value2 = cfg["ENTRA_CLIENT_ID"];
		string value3 = cfg["ENTRA_CLIENT_SECRET"];
		if (!string.IsNullOrWhiteSpace(text2) && !string.IsNullOrWhiteSpace(value2) && !string.IsNullOrWhiteSpace(value3))
		{
			using (FormUrlEncodedContent form = new FormUrlEncodedContent(new Dictionary<string, string>
			{
				{ "client_id", value2 },
				{ "client_secret", value3 },
				{ "scope", "https://graph.microsoft.com/.default" },
				{ "grant_type", "client_credentials" }
			}))
			{
				using HttpResponseMessage tokenResponse = await http.PostAsync("https://login.microsoftonline.com/" + Uri.EscapeDataString(text2) + "/oauth2/v2.0/token", form);
				tokenResponse.EnsureSuccessStatusCode();
				using JsonDocument jsonDocument = JsonDocument.Parse(await tokenResponse.Content.ReadAsStringAsync());
				string text3 = jsonDocument.RootElement.GetProperty("access_token").GetString();
				DateTimeOffset item = DateTimeOffset.UtcNow.AddSeconds(jsonDocument.RootElement.GetProperty("expires_in").GetInt32());
				tokens["graph"] = (text3, item);
				return text3;
			}
		}
		using HttpRequestMessage req = new HttpRequestMessage(HttpMethod.Get, "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fgraph.microsoft.com%2F");
		req.Headers.Add("Metadata", "true");
		using HttpResponseMessage res = await http.SendAsync(req);
		res.EnsureSuccessStatusCode();
		using JsonDocument jsonDocument2 = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
		string text4 = jsonDocument2.RootElement.GetProperty("access_token").GetString();
		DateTimeOffset item2 = DateTimeOffset.FromUnixTimeSeconds(long.Parse(jsonDocument2.RootElement.GetProperty("expires_on").GetString()));
		tokens["graph"] = (text4, item2);
		return text4;
	}

	private async Task<JsonDocument> Send(HttpMethod method, string uri, object? body = null)
	{
		using HttpRequestMessage req = new HttpRequestMessage(method, "https://graph.microsoft.com/v1.0/" + uri);
		HttpRequestHeaders headers = req.Headers;
		headers.Authorization = new AuthenticationHeaderValue("Bearer", await Token());
		req.Headers.Add("ConsistencyLevel", "eventual");
		if (body != null)
		{
			req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
		}
		using HttpResponseMessage res = await http.SendAsync(req);
		string text = await res.Content.ReadAsStringAsync();
		if (!res.IsSuccessStatusCode)
		{
			IEnumerable<string> values;
			string requestId = (res.Headers.TryGetValues("request-id", out values) ? values.FirstOrDefault() : null);
			string safeMessage = "Microsoft Entra could not issue the temporary pass.";
			try
			{
				using JsonDocument jsonDocument = JsonDocument.Parse(text);
				string text2 = jsonDocument.RootElement.GetProperty("error").GetProperty("message").GetString();
				if (!string.IsNullOrWhiteSpace(text2))
				{
					safeMessage = text2;
				}
			}
			catch
			{
			}
			throw new GraphRequestException((int)res.StatusCode, safeMessage, requestId);
		}
		return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
	}

	private string Select()
	{
		string[] source = new string[3]
		{
			cfg["STUDENT_ID_ATTRIBUTE"],
			cfg["SCHOOL_ATTRIBUTE"],
			cfg["ENROLLMENT_ATTRIBUTE"]
		}.Where((string x) => !string.IsNullOrWhiteSpace(x)).ToArray();
		if (source.Any((string x) => !Regex.IsMatch(x, "^[A-Za-z0-9_]+$")))
		{
			throw new InvalidOperationException("Invalid configured Entra attribute name");
		}
		IEnumerable<string> enumerable = source.Where((string x) => !x.StartsWith("extensionAttribute", StringComparison.OrdinalIgnoreCase));
		if (source.Any((string x) => x.StartsWith("extensionAttribute", StringComparison.OrdinalIgnoreCase)))
		{
			enumerable = enumerable.Append("onPremisesExtensionAttributes");
		}
		return string.Join(',', new string[7] { "id", "displayName", "givenName", "surname", "userPrincipalName", "accountEnabled", "userType" }.Concat(enumerable).Distinct<string>(StringComparer.OrdinalIgnoreCase));
	}

	public async Task<HashSet<string>> CheckGroups(string id, IEnumerable<string?> groupIds)
	{
		string[] array = groupIds.Where((string x) => !string.IsNullOrWhiteSpace(x)).Cast<string>().Distinct<string>(StringComparer.OrdinalIgnoreCase)
			.ToArray();
		if (array.Length == 0)
		{
			return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
		}
		using JsonDocument jsonDocument = await Send(HttpMethod.Post, "users/" + Uri.EscapeDataString(id) + "/checkMemberGroups", new
		{
			groupIds = array
		});
		return (from x in jsonDocument.RootElement.GetProperty("value").EnumerateArray()
			select x.GetString() into x
			where !string.IsNullOrWhiteSpace(x)
			select x).Cast<string>().ToHashSet<string>(StringComparer.OrdinalIgnoreCase);
	}

	public async Task<Eligibility> GetEligibility(string id)
	{
		using JsonDocument member = await Send(HttpMethod.Post, "users/" + Uri.EscapeDataString(id) + "/checkMemberGroups", new
		{
			groupIds = new string[1] { cfg["HS_STUDENT_GROUP_ID"] }
		});
		bool inGroup = member.RootElement.GetProperty("value").GetArrayLength() > 0;
		using JsonDocument jsonDocument = await Send(HttpMethod.Get, "users/" + Uri.EscapeDataString(id) + "?$select=" + Select());
		JsonElement rootElement = jsonDocument.RootElement;
		JsonElement value;
		bool flag = rootElement.TryGetProperty("accountEnabled", out value) && value.GetBoolean();
		JsonElement value2;
		string text = (rootElement.TryGetProperty("userType", out value2) ? value2.GetString() : "Member");
		string a = Value(rootElement, cfg["ENROLLMENT_ATTRIBUTE"]);
		bool flag2 = string.IsNullOrWhiteSpace(cfg["ENROLLMENT_ATTRIBUTE"]) || string.Equals(a, cfg["ACTIVE_ENROLLMENT_VALUE"] ?? "Active", StringComparison.OrdinalIgnoreCase);
		string studentId = Value(rootElement, cfg["STUDENT_ID_ATTRIBUTE"]);
		string upn = Value(rootElement, "userPrincipalName") ?? "";
		string school = Value(rootElement, cfg["SCHOOL_ATTRIBUTE"]) ?? LookupSchool(upn, studentId);
		return new Eligibility(inGroup && flag && text == "Member" && flag2, rootElement.GetProperty("id").GetString(), Value(rootElement, "displayName") ?? "Student", upn, studentId, school);
	}

	public async Task<Eligibility?> MatchEligibleAccount(string upn, string studentId)
	{
		string text = upn.Trim().Replace("'", "''");
		string stringToEscape = "userPrincipalName eq '" + text + "'";
		using JsonDocument doc = await Send(HttpMethod.Get, "users?$filter=" + Uri.EscapeDataString(stringToEscape) + "&$select=id&$top=2");
		JsonElement property = doc.RootElement.GetProperty("value");
		if (property.GetArrayLength() != 1)
		{
			return null;
		}
		Eligibility eligibility = await GetEligibility(property[0].GetProperty("id").GetString());
		string a = new string((eligibility.StudentId ?? "").Where(char.IsDigit).ToArray());
		return (eligibility.Eligible && string.Equals(eligibility.Upn, upn, StringComparison.OrdinalIgnoreCase) && string.Equals(a, studentId, StringComparison.Ordinal)) ? eligibility : null;
	}

	public async Task<Eligibility?> FindRegularStudent(string username, string studentId)
	{
		string upn = username.Trim();
		if (!upn.Contains('@')) upn += "@sccc.edu";
		string safe = upn.Replace("'", "''");
		using JsonDocument doc = await Send(HttpMethod.Get, "users?$filter=" + Uri.EscapeDataString("userPrincipalName eq '" + safe + "'") + "&$select=" + Select() + "&$top=2");
		JsonElement users = doc.RootElement.GetProperty("value");
		if (users.GetArrayLength() != 1) return null;
		JsonElement user = users[0];
		string storedId = new string((Value(user, cfg["STUDENT_ID_ATTRIBUTE"]) ?? "").Where(char.IsDigit).ToArray());
		bool enabled = user.TryGetProperty("accountEnabled", out var enabledValue) && enabledValue.GetBoolean();
		string type = user.TryGetProperty("userType", out var typeValue) ? (typeValue.GetString() ?? "Member") : "Member";
		if (!enabled || !string.Equals(type, "Member", StringComparison.OrdinalIgnoreCase) || !string.Equals(storedId, studentId, StringComparison.Ordinal)) return null;
		return new Eligibility(true, user.GetProperty("id").GetString(), Value(user, "displayName") ?? username, Value(user, "userPrincipalName") ?? upn, storedId, null);
	}

	public async Task<bool> IsHighSchoolStudent(string id)
	{
		string? groupId = cfg["HS_STUDENT_GROUP_ID"];
		if (string.IsNullOrWhiteSpace(groupId)) return false;
		HashSet<string> groups = await CheckGroups(id, new[] { groupId });
		return groups.Contains(groupId);
	}

	public async Task<bool> IsOnlineKioskStudentAccount(string id)
	{
		using JsonDocument doc = await Send(
			HttpMethod.Get,
			"users/" + Uri.EscapeDataString(id)
			+ "?$select=accountEnabled,userType,userPrincipalName,onPremisesExtensionAttributes");
		JsonElement user = doc.RootElement;
		bool enabled = user.TryGetProperty("accountEnabled", out JsonElement enabledValue)
			&& enabledValue.ValueKind == JsonValueKind.True;
		string type = Value(user, "userType") ?? "Member";
		string upn = Value(user, "userPrincipalName") ?? "";
		string studentId = new string(
			(Value(user, cfg["STUDENT_ID_ATTRIBUTE"]) ?? "").Where(char.IsDigit).ToArray());

		return enabled
			&& string.Equals(type, "Member", StringComparison.OrdinalIgnoreCase)
			&& upn.EndsWith("@sccc.edu", StringComparison.OrdinalIgnoreCase)
			&& Regex.IsMatch(studentId, "^800[0-9]{6}$");
	}

	public async Task<string?> GetStudentNotificationEmail(string id)
	{
		using JsonDocument doc = await Send(
			HttpMethod.Get,
			"users/" + Uri.EscapeDataString(id) + "?$select=mail,userPrincipalName,proxyAddresses");
		JsonElement user = doc.RootElement;
		List<string> candidates = new List<string>();

		string? mail = Value(user, "mail");
		if (!string.IsNullOrWhiteSpace(mail)) candidates.Add(mail);

		if (user.TryGetProperty("proxyAddresses", out JsonElement proxies)
			&& proxies.ValueKind == JsonValueKind.Array)
		{
			foreach (JsonElement proxy in proxies.EnumerateArray())
			{
				if (proxy.ValueKind != JsonValueKind.String) continue;
				string value = proxy.GetString() ?? "";
				int separator = value.IndexOf(':');
				if (separator >= 0) value = value[(separator + 1)..];
				if (!string.IsNullOrWhiteSpace(value)) candidates.Add(value);
			}
		}

		string? official = candidates.FirstOrDefault(IsStudentNotificationEmail);
		if (!string.IsNullOrWhiteSpace(official)) return official.Trim().ToLowerInvariant();

		string? upn = Value(user, "userPrincipalName");
		if (!string.IsNullOrWhiteSpace(upn)
			&& upn.EndsWith("@sccc.edu", StringComparison.OrdinalIgnoreCase))
		{
			string local = upn[..^"@sccc.edu".Length];
			string derived = local + "@g.sccc.edu";
			if (IsStudentNotificationEmail(derived)) return derived.ToLowerInvariant();
		}
		return null;
	}

	private static bool IsStudentNotificationEmail(string value) =>
		Regex.IsMatch(
			value.Trim(),
			@"^[a-z0-9][a-z0-9._-]{0,63}@g\.sccc\.edu$",
			RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

	public async Task<Eligibility?> FindRegularStudentByIdentity(string firstName, string lastName, string studentId)
	{
		string attribute = cfg["STUDENT_ID_ATTRIBUTE"] ?? "";
		if (!Regex.IsMatch(attribute, "^[A-Za-z0-9_]+$")) return null;
		if (string.IsNullOrWhiteSpace(attribute)) return null;
		string safeFirst = firstName.Trim().Replace("'", "''");
		using JsonDocument doc = await Send(HttpMethod.Get, "users?$filter=" + Uri.EscapeDataString("startswith(displayName,'" + safeFirst + "')") + "&$select=" + Select() + "&$top=25");
		JsonElement users = doc.RootElement.GetProperty("value");
		var matches = users.EnumerateArray().Where(user =>
		{
			string storedId = new string((Value(user, attribute) ?? "").Where(char.IsDigit).ToArray());
			bool enabled = user.TryGetProperty("accountEnabled", out var enabledValue) && enabledValue.GetBoolean();
			string type = user.TryGetProperty("userType", out var typeValue) ? (typeValue.GetString() ?? "Member") : "Member";
			string storedFirst = Value(user, "givenName") ?? "";
			string storedLast = Value(user, "surname") ?? "";
			string display = NameKey(Value(user, "displayName") ?? "");
			bool nameMatches = (!string.IsNullOrWhiteSpace(storedFirst) && !string.IsNullOrWhiteSpace(storedLast))
				? NameKey(storedFirst).StartsWith(NameKey(firstName), StringComparison.Ordinal) && string.Equals(NameKey(storedLast), NameKey(lastName), StringComparison.Ordinal)
				: display.StartsWith(NameKey(firstName), StringComparison.Ordinal) && display.EndsWith(NameKey(lastName), StringComparison.Ordinal);
			return enabled && string.Equals(type, "Member", StringComparison.OrdinalIgnoreCase) && string.Equals(storedId, studentId, StringComparison.Ordinal) && nameMatches;
		}).ToList();
		Console.WriteLine($"Kiosk Entra lookup candidates={users.GetArrayLength()} matches={matches.Count}");
		if (matches.Count != 1) return null;
		JsonElement user = matches[0];
		string storedId = new string((Value(user, attribute) ?? "").Where(char.IsDigit).ToArray());
		return new Eligibility(true, user.GetProperty("id").GetString(), Value(user, "displayName") ?? (firstName + " " + lastName), Value(user, "userPrincipalName") ?? "", storedId, null);
	}

	private static string NameKey(string value) => Regex.Replace(value.Trim().ToLowerInvariant(), "[^a-z0-9]", "");

	public async Task<List<Eligibility>> SearchEligible(string q)
	{
		string safe = q.Trim().Replace("'", "''");
		List<Eligibility> list = new List<Eligibility>();
		string stringToEscape = $"startswith(displayName,'{safe}') or startswith(userPrincipalName,'{safe}')";
		int candidateCount = 0;
		using (JsonDocument doc = await Send(HttpMethod.Get, $"users?$filter={Uri.EscapeDataString(stringToEscape)}&$count=true&$select={Select()}&$top=25"))
		{
			JsonElement property = doc.RootElement.GetProperty("value");
			candidateCount = property.GetArrayLength();
			foreach (JsonElement item in property.EnumerateArray())
			{
				Eligibility eligibility = await GetEligibility(item.GetProperty("id").GetString());
				if (eligibility.Eligible)
				{
					list.Add(eligibility);
				}
			}
		}
		if (candidateCount == 0 && !string.IsNullOrWhiteSpace(cfg["STUDENT_ID_ATTRIBUTE"]))
		{
			string text = cfg["STUDENT_ID_ATTRIBUTE"];
			string text2 = (text.StartsWith("extensionAttribute", StringComparison.OrdinalIgnoreCase) ? ("onPremisesExtensionAttributes/" + text) : text);
			string stringToEscape2 = text2 + " eq '" + safe + "'";
			using JsonDocument doc = await Send(HttpMethod.Get, $"users?$filter={Uri.EscapeDataString(stringToEscape2)}&$count=true&$select={Select()}&$top=5");
			foreach (JsonElement item2 in doc.RootElement.GetProperty("value").EnumerateArray())
			{
				Eligibility eligibility2 = await GetEligibility(item2.GetProperty("id").GetString());
				if (eligibility2.Eligible)
				{
					list.Add(eligibility2);
				}
			}
		}
		return list;
	}

	public async Task<List<EupStudent>> NewEupStudents()
	{
		DateTimeOffset result;
		DateTimeOffset dateTimeOffset = (DateTimeOffset.TryParse(cfg["EUP_REPORT_START_UTC"], out result) ? result : new DateTimeOffset(2026, 8, 7, 0, 0, 0, TimeSpan.Zero));
		string stringToEscape = $"createdDateTime ge {dateTimeOffset.UtcDateTime:yyyy-MM-ddTHH:mm:ssZ}";
		using JsonDocument jsonDocument = await Send(HttpMethod.Get, "users?$filter=" + Uri.EscapeDataString(stringToEscape) + "&$select=createdDateTime,displayName,userPrincipalName,mail,onPremisesSamAccountName,onPremisesExtensionAttributes&$top=999");
		List<EupStudent> list = new List<EupStudent>();
		foreach (JsonElement item in jsonDocument.RootElement.GetProperty("value").EnumerateArray())
		{
			JsonElement value;
			JsonElement jsonElement = ((item.TryGetProperty("onPremisesExtensionAttributes", out value) && value.ValueKind == JsonValueKind.Object) ? value : default(JsonElement));
			JsonElement value2;
			string text = ((jsonElement.ValueKind == JsonValueKind.Object && jsonElement.TryGetProperty("extensionAttribute2", out value2) && value2.ValueKind == JsonValueKind.String) ? (value2.GetString() ?? "") : "");
			if (text.StartsWith("800", StringComparison.Ordinal) && text.Length == 9)
			{
				JsonElement value3;
				DateTimeOffset createdUtc = ((item.TryGetProperty("createdDateTime", out value3) && value3.ValueKind == JsonValueKind.String) ? value3.GetDateTimeOffset() : DateTimeOffset.MinValue);
				string displayName = Value(item, "displayName") ?? "Unknown student";
				string text2 = Value(item, "userPrincipalName") ?? "";
				string text3 = Value(item, "mail") ?? "";
				string a = Value(item, "onPremisesSamAccountName") ?? "";
				object obj;
				if (!text2.EndsWith("@sccc.edu", StringComparison.OrdinalIgnoreCase))
				{
					obj = "";
				}
				else
				{
					string text4 = text2;
					obj = text4.Substring(0, text4.Length - 9);
				}
				string text5 = (string)obj;
				string text6 = (string.IsNullOrWhiteSpace(text5) ? "" : (text5 + "@g.sccc.edu"));
				List<string> list2 = new List<string>();
				if (string.IsNullOrWhiteSpace(text5) || !Regex.IsMatch(text5, "^[a-z0-9]+(?:\\.[a-z0-9]+)+[0-9]*$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
				{
					list2.Add("username format");
				}
				if (!string.Equals(a, text5, StringComparison.OrdinalIgnoreCase))
				{
					list2.Add("SAM mismatch");
				}
				if (!string.IsNullOrWhiteSpace(text3) && !string.Equals(text3, text6, StringComparison.OrdinalIgnoreCase) && !string.Equals(text3, text2, StringComparison.OrdinalIgnoreCase))
				{
					list2.Add("unexpected Entra mail");
				}
				list.Add(new EupStudent(createdUtc, displayName, text, text2, text6, (list2.Count == 0) ? "Validated" : ("Review: " + string.Join(", ", list2)), list2.Count == 0));
			}
		}
		return list.OrderByDescending((EupStudent x) => x.CreatedUtc).ToList();
	}

	private async Task<TapResult> CreateTapOnce(string id)
	{
		string user = Uri.EscapeDataString(id);
		int result;
		int requestedLifetime = (int.TryParse(cfg["TAP_LIFETIME_MINUTES"], out result) ? result : 60);
		// Microsoft Graph replaces the user's existing TAP when a new one is
		// created. Deleting it first creates an avoidable 409 race while Entra is
		// updating authentication-method state.
		using JsonDocument jsonDocument = await Send(HttpMethod.Post, "users/" + user + "/authentication/temporaryAccessPassMethods", new
		{
			lifetimeInMinutes = requestedLifetime,
			isUsableOnce = true
		});
		JsonElement rootElement = jsonDocument.RootElement;
		JsonElement value3;
		int num = (rootElement.TryGetProperty("lifetimeInMinutes", out value3) ? value3.GetInt32() : requestedLifetime);
		JsonElement value4;
		return new TapResult(rootElement.GetProperty("temporaryAccessPass").GetString(), rootElement.GetProperty("startDateTime").GetDateTimeOffset().AddMinutes(num), rootElement.TryGetProperty("id", out value4) ? value4.GetString() : null);
	}

	public async Task<TapResult> CreateTap(string id)
	{
		SemaphoreSlim gate = tapLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
		await gate.WaitAsync();
		try
		{
			for (int attempt = 1; ; attempt++)
			{
				try
				{
					return await CreateTapOnce(id);
				}
				catch (GraphRequestException ex) when (attempt < 3 &&
					(ex.StatusCode == 409 || ex.StatusCode == 429 || ex.SafeMessage.Contains("concurrent", StringComparison.OrdinalIgnoreCase)))
				{
					await Task.Delay(TimeSpan.FromSeconds(attempt));
				}
			}
		}
		finally
		{
			gate.Release();
		}
	}

	public async Task SetPassword(string id, string password)
	{
		using JsonDocument response = await Send(HttpMethod.Patch, "users/" + Uri.EscapeDataString(id), new
		{
			passwordProfile = new
			{
				password,
				forceChangePasswordNextSignIn = false
			}
		});
	}

	public async Task<MfaRegistrationStatus> GetMfaRegistrationStatus(string id)
	{
		using JsonDocument phones = await Send(HttpMethod.Get, "users/" + Uri.EscapeDataString(id) + "/authentication/phoneMethods");
		bool hasMobilePhone = phones.RootElement.TryGetProperty("value", out JsonElement phoneValues)
			&& phoneValues.ValueKind == JsonValueKind.Array
			&& phoneValues.EnumerateArray().Any(phone => phone.TryGetProperty("phoneType", out JsonElement type)
				&& type.ValueKind == JsonValueKind.String
				&& (string.Equals(type.GetString(), "mobile", StringComparison.OrdinalIgnoreCase)
					|| string.Equals(type.GetString(), "alternateMobile", StringComparison.OrdinalIgnoreCase)));

		using JsonDocument authenticators = await Send(HttpMethod.Get, "users/" + Uri.EscapeDataString(id) + "/authentication/microsoftAuthenticatorMethods");
		bool hasMicrosoftAuthenticator = authenticators.RootElement.TryGetProperty("value", out JsonElement authenticatorValues)
			&& authenticatorValues.ValueKind == JsonValueKind.Array
			&& authenticatorValues.GetArrayLength() > 0;

		return new MfaRegistrationStatus(hasMobilePhone, hasMicrosoftAuthenticator);
	}

	public async Task<int?> CreateSupportTicket(KioskGrant grant, string actor)
	{
		string url = cfg["IT_PORTAL_TICKET_URL"] ?? "http://127.0.0.1:3010/api/tickets";
		using HttpRequestMessage req = new HttpRequestMessage(HttpMethod.Post, url);
		req.Headers.Add("X-SCCC-Kiosk-Request", "1");
		req.Content = new StringContent(JsonSerializer.Serialize(new
		{
			subject = "Student account access failure - " + grant.Upn,
			description = "The authenticated IT kiosk verified the student and completed account recovery, but the student reports that SCCC email access is still unavailable. Student: " + grant.DisplayName + "; account: " + grant.Upn + "; IT operator object ID: " + actor + ". No password or Temporary Access Pass is included in this ticket.",
			department = "students",
			userType = "student",
			category = "account_login",
			contactMethod = "walk_in",
			priority = "high",
			severity = "high",
			eventDate = "",
			requesterName = grant.DisplayName,
			requesterEmail = grant.Upn,
			requesterPhone = ""
		}), Encoding.UTF8, "application/json");
		using HttpResponseMessage res = await http.SendAsync(req);
		string content = await res.Content.ReadAsStringAsync();
		res.EnsureSuccessStatusCode();
		using JsonDocument doc = JsonDocument.Parse(content);
		return doc.RootElement.TryGetProperty("id", out var id) && id.TryGetInt32(out int ticketId) ? ticketId : null;
	}

	private string? LookupSchool(string upn, string? studentId)
	{
		if (schoolLookup.TryGetValue("upn:" + upn.Trim().ToLowerInvariant(), out string value))
		{
			return value;
		}
		if (!string.IsNullOrWhiteSpace(studentId) && schoolLookup.TryGetValue("id:" + studentId.Trim(), out string value2))
		{
			return value2;
		}
		return null;
	}

	private static Dictionary<string, string> LoadSchoolLookup(string? file)
	{
		Dictionary<string, string> dictionary = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
		if (string.IsNullOrWhiteSpace(file) || !File.Exists(file))
		{
			return dictionary;
		}
		foreach (string item in File.ReadLines(file).Skip(1))
		{
			string[] array = item.Split('\t');
			if (array.Length < 3)
			{
				continue;
			}
			string text = array[0].Trim();
			string text2 = array[1].Trim();
			string value = array[2].Trim();
			if (!string.IsNullOrWhiteSpace(value))
			{
				if (!string.IsNullOrWhiteSpace(text))
				{
					dictionary["upn:" + text.ToLowerInvariant()] = value;
				}
				if (!string.IsNullOrWhiteSpace(text2))
				{
					dictionary["id:" + text2] = value;
				}
			}
		}
		return dictionary;
	}

	private static string? Value(JsonElement e, string? n)
	{
		if (string.IsNullOrWhiteSpace(n))
		{
			return null;
		}
		if (n.StartsWith("extensionAttribute", StringComparison.OrdinalIgnoreCase) && e.TryGetProperty("onPremisesExtensionAttributes", out var value) && value.ValueKind == JsonValueKind.Object && value.TryGetProperty(n, out var value2) && value2.ValueKind == JsonValueKind.String)
		{
			return value2.GetString();
		}
		if (!e.TryGetProperty(n, out var value3) || value3.ValueKind != JsonValueKind.String)
		{
			return null;
		}
		return value3.GetString();
	}
}
