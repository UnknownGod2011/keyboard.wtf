namespace KeyboardWtf.Tests;

using KeyboardWtf.Services;
using Xunit;

public sealed class BrowserLauncherServiceTests
{
    [Theory]
    [InlineData("Google Chrome", "chrome")]
    [InlineData("Microsoft Edge", "edge")]
    [InlineData("Brave browser", "brave")]
    [InlineData("default browser", "")]
    public void BrowserNamesNormalize(string input, string expected)
    {
        Assert.Equal(expected, BrowserLauncherService.NormalizeBrowser(input));
    }

    [Fact]
    public void SearchUrlsAreServiceSpecific()
    {
        Assert.Contains("youtube.com", BrowserLauncherService.BuildSearchUrl("MrBeast", "youtube"));
        Assert.Contains("google.com", BrowserLauncherService.BuildSearchUrl("keyboard wtf", "google"));
    }

    [Fact]
    public void UnsafeSchemesAreRejected()
    {
        Assert.False(BrowserLauncherService.TryNormalizeUrl("file:///C:/Windows", out _));
    }
}
