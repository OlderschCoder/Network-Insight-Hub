using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

public sealed class AdminRecoveryTests
{
    private static AdminRecoveryRequest ValidRequest() => new(
        "Ada",
        "Lovelace",
        "800123456",
        "ada.lovelace",
        7559,
        "callback_to_number_on_file",
        true,
        true,
        new AdminRecoveryActor(1, "Authorized Operator", "helpdesk"));

    [Fact]
    public void Validation_accepts_a_confirmed_independently_verified_request()
    {
        Assert.Null(AdminRecoveryEndpoints.Validate(ValidRequest()));
    }

    [Fact]
    public void Validation_rejects_matching_data_without_independent_verification()
    {
        AdminRecoveryRequest request = ValidRequest() with { IdentityVerified = false };
        Assert.Contains("Independent identity verification", AdminRecoveryEndpoints.Validate(request));
    }

    [Fact]
    public void Validation_rejects_a_non_student_number()
    {
        AdminRecoveryRequest request = ValidRequest() with { StudentId = "123456789" };
        Assert.Contains("beginning with 800", AdminRecoveryEndpoints.Validate(request));
    }

    [Fact]
    public void Validation_rejects_an_unauthorized_role()
    {
        AdminRecoveryRequest request = ValidRequest() with
        {
            Actor = new AdminRecoveryActor(2, "Viewer", "viewer"),
        };
        Assert.Contains("not authorized", AdminRecoveryEndpoints.Validate(request));
    }

    [Fact]
    public async Task Signed_request_is_accepted_once_and_replay_is_rejected()
    {
        string directory = Path.Combine(Path.GetTempPath(), $"sccc-admin-recovery-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        string keyPath = Path.Combine(directory, "key");
        const string key = "0123456789abcdef0123456789abcdef";
        await File.WriteAllTextAsync(keyPath, key);
        try
        {
            IConfiguration config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ADMIN_RECOVERY_ALLOWED_IP"] = "10.0.0.44",
                    ["ADMIN_RECOVERY_HMAC_KEY_PATH"] = keyPath,
                })
                .Build();
            AdminRecoverySecurity security = new(config);
            DefaultHttpContext context = new();
            context.Connection.RemoteIpAddress = IPAddress.Parse("10.0.0.44");
            string timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            string nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
            const string body = "{\"ticket\":7559}";
            string signature = Convert.ToHexString(
                AdminRecoverySecurity.ComputeSignature(key, timestamp, nonce, body))
                .ToLowerInvariant();
            context.Request.Headers["X-SCCC-Timestamp"] = timestamp;
            context.Request.Headers["X-SCCC-Nonce"] = nonce;
            context.Request.Headers["X-SCCC-Signature"] = signature;

            (bool valid, _) = await security.Verify(context, body);
            (bool replayValid, string replayError) = await security.Verify(context, body);

            Assert.True(valid);
            Assert.False(replayValid);
            Assert.Contains("already used", replayError);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }
}
