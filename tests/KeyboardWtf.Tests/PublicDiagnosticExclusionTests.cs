using System.Reflection;
using KeyboardWtf.Services;
using Xunit;

namespace KeyboardWtf.Tests;

public sealed class PublicDiagnosticExclusionTests
{
    [Theory]
    [InlineData("KeyboardWtf.Services.PrivatePersonalRecordingInput")]
    [InlineData("KeyboardWtf.Services.PersonalAudioIngressDiagnostics")]
    public void Canonical_public_assembly_contains_no_inert_private_diagnostic_types(string name)
    {
        var type = typeof(KeyboardWtfApp).Assembly.GetType(name, throwOnError: false);
#if KEYBOARD_WTF_TEST_PUBLIC_PRODUCTION
        Assert.Null(type);
#else
        Assert.NotNull(type); // Internal/legacy tooling remains available outside the public flavor.
#endif
    }

    [Fact]
    public void Canonical_public_assembly_has_no_recording_audit_adapter()
    {
#if KEYBOARD_WTF_TEST_PUBLIC_PRODUCTION
        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        Assert.Null(typeof(KeyboardWtfApp).GetProperty("PrivateAuditConversation", flags));
        foreach (var name in new[] { "StartPrivateRecordingAuditAsync", "ReplayPrivateRecordingAsync", "ObservePrivateRecording" })
            Assert.Null(typeof(GeminiLiveConversationService).GetMethod(name, flags));
        Assert.Null(typeof(WebSettingsService).GetMethod("HandlePrivateRecordingAudit", flags));
#endif
    }
}
