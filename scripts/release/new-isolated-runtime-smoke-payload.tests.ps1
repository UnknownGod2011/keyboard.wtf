$ErrorActionPreference = 'Stop'
$tool = Join-Path $PSScriptRoot 'new-isolated-runtime-smoke-payload.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('kwt-smoke-source-' + [Guid]::NewGuid().ToString('N'))
$copies = [Collections.Generic.List[string]]::new()
$passed = 0
function Assert-Smoke([bool]$Condition) {
    if (-not $Condition) { throw 'smoke_copy_test_failed' }
    $script:passed++
}
try {
    . $tool
    [IO.Directory]::CreateDirectory($fixture) | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixture 'keyboard.wtf.exe'), 'inert plain text; never executed')
    [IO.Directory]::CreateDirectory((Join-Path $fixture 'resources')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixture 'resources/data.txt'), 'synthetic resource')
    $before = (Get-FileHash -LiteralPath (Join-Path $fixture 'keyboard.wtf.exe')).Hash
    $copy = New-IsolatedRuntimeSmokePayload -SourceDirectory $fixture
    $copies.Add($copy.CopyDirectory)
    Assert-Smoke ($copy.FileCount -eq 2)
    Assert-Smoke ($copy.Executable -ne (Join-Path $fixture 'keyboard.wtf.exe'))
    Assert-Smoke ((Get-FileHash -LiteralPath $copy.Executable).Hash -ceq $before)
    Assert-Smoke ([IO.File]::ReadAllText((Join-Path $copy.CopyDirectory 'resources/data.txt')) -ceq 'synthetic resource')
    # Inert data mutation ONLY: simulate adjacent runtime marker creation.
    foreach ($marker in @('.keyboard.wtf-update-reservation', '.keyboard.wtf-update-activity')) {
        [IO.File]::WriteAllText((Join-Path $copy.CopyDirectory $marker), '')
        Assert-Smoke (-not [IO.File]::Exists((Join-Path $fixture $marker)))
    }
    Assert-Smoke ((Get-FileHash -LiteralPath (Join-Path $fixture 'keyboard.wtf.exe')).Hash -ceq $before)
    Assert-Smoke (@(Get-ChildItem -LiteralPath $fixture -File -Recurse).Count -eq 2)
    foreach ($marker in @('.keyboard.wtf-update-reservation', '.keyboard.wtf-update-activity')) {
        $path = Join-Path $fixture ('resources/' + $marker)
        [IO.File]::WriteAllText($path, '')
        $rejected = $false
        try { New-IsolatedRuntimeSmokePayload -SourceDirectory $fixture | Out-Null }
        catch { $rejected = $_.Exception.Message -ceq 'smoke_copy_reserved_marker' }
        Assert-Smoke $rejected
        [IO.File]::Delete($path)
    }
    $rejected = $false
    try { New-IsolatedRuntimeSmokePayload -SourceDirectory (Join-Path $fixture 'resources') | Out-Null }
    catch { $rejected = $_.Exception.Message -ceq 'smoke_copy_executable_missing' }
    Assert-Smoke $rejected
    $rejected = $false
    try { New-IsolatedRuntimeSmokePayload -SourceDirectory (Join-Path $fixture 'missing') | Out-Null }
    catch { $rejected = $_.Exception.Message -ceq 'smoke_copy_source_invalid' }
    Assert-Smoke $rejected
    $junction = Join-Path $fixture 'junction'
    try {
        New-Item -ItemType Junction -Path $junction -Target (Join-Path $fixture 'resources') | Out-Null
        $rejected = $false
        try { New-IsolatedRuntimeSmokePayload -SourceDirectory $fixture | Out-Null }
        catch { $rejected = $_.Exception.Message -ceq 'smoke_copy_reparse' }
        Assert-Smoke $rejected
    }
    finally {
        if ([IO.Directory]::Exists($junction)) { [IO.Directory]::Delete($junction) }
    }
    for ($cycle = 0; $cycle -lt 20; $cycle++) {
        $repeat = New-IsolatedRuntimeSmokePayload -SourceDirectory $fixture
        $copies.Add($repeat.CopyDirectory)
        Assert-Smoke ((Get-FileHash -LiteralPath $repeat.Executable).Hash -ceq $before)
        Assert-Smoke ($repeat.CopyDirectory -ne $copy.CopyDirectory)
    }
    $workflow = [IO.File]::ReadAllText((Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.github/workflows/paid-staging-ci.yml'))
    Assert-Smoke ($workflow.Contains('test-paid-production-runtime.ps1 -Executable $smokePayload.Executable'))
    Assert-Smoke ($workflow.Contains('generate-sbom.ps1 -BuildDirectory dist/release/keyboard-wtf-win-x64'))
    [ordered]@{passed=$passed;failed=0;scope='plain synthetic files only';realJunctionExercised=$true;copyCycles=20;appExecuted=$false;packageApproved=$false} | ConvertTo-Json
}
finally {
    # No processes/callbacks are launched. Delete only exact newly owned roots.
    foreach ($owned in @($copies.ToArray()) + @($fixture)) {
        $parent = [IO.Path]::GetDirectoryName($owned)
        $name = [IO.Path]::GetFileName($owned)
        if ($parent -ne [IO.Path]::GetTempPath().TrimEnd('\') -or
            $name -notmatch '^kwt-(smoke-source|runtime-smoke-copy)-[a-f0-9]{32}$') { throw 'smoke_test_cleanup_refused' }
        if ([IO.Directory]::Exists($owned)) { Remove-Item -LiteralPath $owned -Recurse -Force }
    }
}
