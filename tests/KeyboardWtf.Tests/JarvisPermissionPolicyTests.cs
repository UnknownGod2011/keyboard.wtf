namespace KeyboardWtf.Tests;

using KeyboardWtf.Services;
using Xunit;

public sealed class JarvisPermissionPolicyTests
{
    [Theory]
    [InlineData("inspect_screen", "")]
    [InlineData("take_screenshot", "")]
    [InlineData("take_photo", "")]
    [InlineData("open_camera", "")]
    [InlineData("virtual_desktop_action", "close")]
    public void PrivacyAndDestructiveDesktopActionsAlwaysAsk(string tool, string action)
    {
        Assert.True(JarvisPermissionPolicy.RequiresConfirmation(
            tool,
            action,
            "",
            JarvisPermissionMode.AutoExecute));
    }

    [Fact]
    public void NormalWindowCloseAutoExecutes()
    {
        Assert.False(JarvisPermissionPolicy.RequiresConfirmation(
            "window_action",
            "close",
            "",
            JarvisPermissionMode.AutoExecute));
    }

    [Fact]
    public void RoutineActionsAskInAlwaysAskMode()
    {
        Assert.True(JarvisPermissionPolicy.RequiresConfirmation(
            "open_app",
            "",
            "Notepad",
            JarvisPermissionMode.AlwaysAsk));
    }

    [Fact]
    public void ReadOnlySearchDoesNotAsk()
    {
        Assert.False(JarvisPermissionPolicy.RequiresConfirmation(
            "search_files",
            "",
            "",
            JarvisPermissionMode.AlwaysAsk));
    }
}
