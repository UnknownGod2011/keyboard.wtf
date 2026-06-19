namespace KeyboardWtf.Tests;

using System.Text.Json;
using KeyboardWtf.Services;
using Xunit;

public sealed class RoutineMemoryTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "keyboard-wtf-routine-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task RememberRoutineSavesWorkflowAndFuzzyTrigger()
    {
        Directory.CreateDirectory(_root);
        var settings = new SettingsService(Path.Combine(_root, "settings.json"));
        settings.Load();
        settings.Current.JarvisPermissionMode = JarvisPermissionMode.AutoExecute;
        var mappings = new LearnedMappingService(Path.Combine(_root, "mappings.json"));
        mappings.Load();
        var history = new JarvisActionHistoryService(Path.Combine(_root, "history.json"));
        using var automation = new JarvisAutomationService(
            new NotificationService(null),
            settings,
            history,
            mappings,
            () => { });
        var args = JsonSerializer.SerializeToElement(new
        {
            trigger = "initialize my setup",
            apps = "Notepad",
            urls = "",
            folder = "",
        });

        var result = await automation.ExecuteAsync("remember_routine", args, CancellationToken.None);

        Assert.True((bool)result["ok"]);
        Assert.Contains(
            settings.Current.JarvisWorkflows,
            workflow => workflow.Name.Equals("initialize my setup", StringComparison.OrdinalIgnoreCase)
                && workflow.Apps == "Notepad");
        Assert.Contains(
            mappings.Search("initialize my set", LearnedMappingKind.Workflow, 3),
            mapping => mapping.Target.Equals("initialize my setup", StringComparison.OrdinalIgnoreCase));
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_root))
                Directory.Delete(_root, true);
        }
        catch { }
    }
}
