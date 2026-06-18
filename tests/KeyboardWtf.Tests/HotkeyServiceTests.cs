namespace KeyboardWtf.Tests;

using KeyboardWtf.Services;
using Xunit;

public sealed class HotkeyServiceTests
{
    [Fact]
    public void ConflictFallbacksDoNotUseReservedCursivisShortcut()
    {
        Assert.Equal("Ctrl+Alt+J", HotkeyService.JarvisFallback);
        Assert.Equal("Ctrl+Alt+Escape", HotkeyService.CancelFallback);
        Assert.DoesNotContain("Space", HotkeyService.JarvisFallback, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Space", HotkeyService.CancelFallback, StringComparison.OrdinalIgnoreCase);
    }
}
