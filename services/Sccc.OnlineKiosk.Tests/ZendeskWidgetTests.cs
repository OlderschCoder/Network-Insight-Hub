public sealed class ZendeskWidgetTests
{
    [Fact]
    public void UsesScccWidgetByDefault()
    {
        string html = OnlineKioskEndpoints.ZendeskWidget(null);

        Assert.Contains("id='ze-snippet'", html);
        Assert.Contains("f7fc8059-ca06-40d4-a674-474e58641188", html);
    }

    [Fact]
    public void AllowsWidgetToBeDisabledExplicitly()
    {
        Assert.Equal("", OnlineKioskEndpoints.ZendeskWidget(""));
    }

    [Fact]
    public void EncodesConfiguredWidgetKey()
    {
        string html = OnlineKioskEndpoints.ZendeskWidget("key&unsafe");

        Assert.Contains("key&amp;unsafe", html);
        Assert.DoesNotContain("key&unsafe", html);
    }
}
