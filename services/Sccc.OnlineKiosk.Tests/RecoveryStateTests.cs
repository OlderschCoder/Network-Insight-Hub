using Microsoft.Extensions.Configuration;

public sealed class RecoveryStateTests
{
    [Fact]
    public void Assisted_grant_preserves_actor_and_student_context()
    {
        OnlineIdentityService identities = new();
        string token = identities.CreateGrant(
            "object-id",
            "student@sccc.edu",
            "Student Name",
            "800123456",
            "insights:1:Authorized Operator",
            assisted: true);

        KioskGrant? grant = identities.GetGrant(token);

        Assert.NotNull(grant);
        Assert.True(grant.Assisted);
        Assert.Equal("800123456", grant.StudentId);
        Assert.Equal("insights:1:Authorized Operator", grant.Actor);
    }

    [Fact]
    public async Task Assisted_reset_bypasses_used_window_but_not_active_reservation()
    {
        string directory = Path.Combine(Path.GetTempPath(), $"sccc-reset-guard-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            IConfiguration config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ONLINE_RESET_LEDGER_PATH"] = Path.Combine(directory, "ledger.json"),
                })
                .Build();
            OnlineResetGuard guard = new(config);
            TimeSpan window = TimeSpan.FromDays(30);

            await using (OnlineResetGuard.OnlineResetLease? first = await guard.TryBegin("object-id", window))
            {
                Assert.NotNull(first);
                await first.Complete();
            }

            Assert.Null(await guard.TryBegin("object-id", window));
            await using OnlineResetGuard.OnlineResetLease? assisted =
                await guard.TryBegin("object-id", window, bypassUsedWindow: true);
            Assert.NotNull(assisted);
            Assert.Null(await guard.TryBegin("object-id", window, bypassUsedWindow: true));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }
}
