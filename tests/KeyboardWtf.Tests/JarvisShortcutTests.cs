namespace KeyboardWtf.Tests;

using KeyboardWtf.Services;
using Xunit;

public sealed class JarvisShortcutTests
{
    [Theory]
    [InlineData("new tab", "^t")]
    [InlineData("close this website", "^w")]
    [InlineData("go to the next tab", "^{TAB}")]
    [InlineData("go to the previous tab", "^+{TAB}")]
    [InlineData("reopen closed tab", "^+t")]
    [InlineData("refresh", "^r")]
    [InlineData("back", "%{LEFT}")]
    [InlineData("forward", "%{RIGHT}")]
    [InlineData("downloads", "^j")]
    [InlineData("history", "^h")]
    [InlineData("find on page", "^f")]
    public void BrowserActionsMapOnlyToAllowlistedShortcuts(string action, string expected)
    {
        Assert.Equal(expected, JarvisAutomationService.BrowserShortcutForAction(action));
    }

    [Theory]
    [InlineData("create a new desktop", 0x44)]
    [InlineData("switch to next desktop", 0x27)]
    [InlineData("switch to previous desktop", 0x25)]
    [InlineData("close current desktop", 0x73)]
    [InlineData("move window to desktop", 0)]
    public void VirtualDesktopActionsMapOnlyToWindowsShortcuts(string action, int expected)
    {
        Assert.Equal((byte)expected, JarvisAutomationService.VirtualDesktopKeyForAction(action));
    }
}
