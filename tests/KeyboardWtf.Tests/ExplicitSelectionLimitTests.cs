using System.Text.Json;
using KeyboardWtf.Services;
using Xunit;

namespace KeyboardWtf.Tests;

public sealed class ExplicitSelectionLimitTests
{
    [Theory]
    [InlineData(5999)]
    [InlineData(6000)]
    [InlineData(6001)]
    [InlineData(32000)]
    [InlineData(49999)]
    [InlineData(50000)]
    [InlineData(50001)]
    public void Explicit_selection_is_complete_or_rejected_without_prefix(int length)
    {
        var text = new string('x', length);
        var result = JarvisAutomationService.SelectionResult(text, fresh: true);
        Assert.Equal(length <= 50000, result["ok"]);
        Assert.Equal(length <= 50000 ? text : "", result["text"]);
        Assert.Equal(length > 50000, result["truncated"]);
        if (length > 50000) Assert.Contains("50,000", (string)result["message"]);
    }

    [Fact]
    public void Unicode_and_newlines_are_preserved_without_cutting_at_the_boundary()
    {
        var text = "\r\nमराठी 日本語 👋\n";
        text = text + new string('x', 50000 - text.Length - 2) + "😀";
        Assert.Equal(50000, text.Length);
        var result = JarvisAutomationService.SelectionResult(text, fresh: true);
        Assert.Equal(text, result["text"]);
        Assert.True(JsonSerializer.SerializeToUtf8Bytes(result).Length < 1_048_576);
        Assert.Equal("", JarvisAutomationService.SelectionResult(text + "x", true)["text"]);
        var worstEscaping = JarvisAutomationService.SelectionResult(new string('\u4e00', 50000), true);
        Assert.True(JsonSerializer.SerializeToUtf8Bytes(worstEscaping).Length < 1_048_576);
    }

    [Fact]
    public void Known_partial_old_Helper_capture_cannot_claim_complete_processing()
    {
        var result = JarvisAutomationService.SelectionResult(new string('x', 6000), true, truncated: true);
        Assert.Equal(false, result["ok"]);
        Assert.Equal("", result["text"]);
        Assert.Contains("incomplete", (string)result["message"]);
        var oversized = JarvisAutomationService.SelectionResult("", true, true, 50001);
        Assert.Equal(false, oversized["ok"]);
        Assert.Contains("50,000", (string)oversized["message"]);
    }

    [Fact]
    public void Initial_full_source_does_not_expand_BA_or_recent_source_budgets()
    {
        var full = new string('x', 50000);
        var capture = JarvisAutomationService.SelectionResult(full, true);
        Assert.True(CommandRegistry.TryGetCapturedContextText(capture, out var retained));
        Assert.Equal(6000, retained.Length);
        Assert.True(CommandRegistry.CapturedContextIsPartial(capture, retained));
        Assert.Equal(full, capture["text"]);
        Assert.Equal(false, capture["truncated"]);
        var task = CommandRegistry.BuildBrowserTaskWithCapturedContext("Fill the form", "selected text", retained,
            CommandRegistry.CapturedContextIsPartial(capture, retained));
        Assert.Contains("source is partial", task);
        Assert.True(task.Length <= 10000);
        Assert.Equal(8000, JarvisAutomationService.ClipboardContextCharacterLimit);
    }
}
