param(
    [ValidateSet('full', 'targeted')][string]$Mode = 'full',
    [string[]]$Tests = @(),
    [string]$NodePath,
    [string]$NpmCli
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$functionsRoot = Join-Path $projectRoot 'functions'
$oldPath = $env:PATH
$oldSelection = $env:LINE_OA_TEST_FILES_JSON
$oldOutputEncoding = $OutputEncoding
$oldConsoleEncoding = [Console]::OutputEncoding
$pushed = $false
$checkExit = 1

try {
    if (-not $NodePath) {
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw '找不到 Node；請用 -NodePath 指定已安裝的 Node 22 node.exe。' }
        $NodePath = $nodeCommand.Source
    }
    $node = (Resolve-Path -LiteralPath $NodePath).ProviderPath
    $version = & $node --version
    if ($LASTEXITCODE -ne 0 -or "$version" -notmatch '^v22\.') {
        throw "需要 Node 22，目前是 $version ($node)；請用 -NodePath 指定正確版本。"
    }
    $env:PATH = (Split-Path -Parent $node) + [IO.Path]::PathSeparator + $oldPath
    $OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

    $arguments = @()
    if ($Mode -eq 'targeted') {
        if ($Tests.Count -eq 0) { throw 'targeted 模式必須以 -Tests 指定至少一個 src/ 下的測試檔。' }
        $sourcePrefix = [IO.Path]::GetFullPath((Join-Path $functionsRoot 'src')) + [IO.Path]::DirectorySeparatorChar
        $selected = @()
        foreach ($test in $Tests) {
            $candidate = $test
            if (-not [IO.Path]::IsPathRooted($candidate)) { $candidate = Join-Path $functionsRoot $candidate }
            $candidate = [IO.Path]::GetFullPath($candidate)
            if (-not $candidate.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase) -or
                $candidate -notmatch '\.(test|spec)\.[cm]?[jt]sx?$' -or
                $candidate.Substring($sourcePrefix.Length) -match '(^|[\\/])(node_modules|\.local|lib|coverage)[\\/]' -or
                -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                throw "無效的測試檔：$test；請指定現行 functions/src/ 內確實存在的測試檔。"
            }
            $selected += $candidate
        }
        $vitest = Join-Path $functionsRoot 'node_modules/vitest/vitest.mjs'
        if (-not (Test-Path -LiteralPath $vitest -PathType Leaf)) { throw '找不到本機 Vitest，請先完成專案依賴安裝。' }
        # Vitest positional filters are substrings (.test.ts also matches .test.tsx).
        # The config uses this exact set for collection and verifies the collected identities.
        $env:LINE_OA_TEST_FILES_JSON = ConvertTo-Json -InputObject @($selected) -Compress
        $arguments = @($vitest, 'run', '--config', (Join-Path $functionsRoot 'vitest.config.mts'))
        $scope = $Tests -join ', '
    } else {
        $env:LINE_OA_TEST_FILES_JSON = $null
        if ($Tests.Count -gt 0) { throw '-Tests 僅適用於 -Mode targeted，完整檢查不接受測試篩選。' }
        if (-not $NpmCli) {
            $npmCandidates = @($env:npm_execpath, (Join-Path (Split-Path -Parent $node) 'node_modules/npm/bin/npm-cli.js'))
            $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue
            if ($npmCommand) { $npmCandidates += Join-Path (Split-Path -Parent $npmCommand.Source) 'node_modules/npm/bin/npm-cli.js' }
            $NpmCli = $npmCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
        }
        if (-not $NpmCli) { throw '找不到 npm-cli.js；請用 -NpmCli 指定已安裝的 npm CLI。' }
        $NpmCli = (Resolve-Path -LiteralPath $NpmCli).ProviderPath
        $arguments = @($NpmCli, '--prefix', $functionsRoot, 'run', 'verify')
        $scope = '完整離線檢查（型別、應用測試、建置及工具測試）'
    }

    $logDirectory = Join-Path $projectRoot '.local/checks'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $logName = '{0}-{1}-{2}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss-fff'), $Mode, ([Guid]::NewGuid().ToString('N').Substring(0, 8))
    $logPath = Join-Path $logDirectory $logName
    $header = @("Node: $version ($node)", "Working directory: $functionsRoot", "Scope: $scope")
    $header | ForEach-Object { Write-Output $_ }
    $header | Out-File -LiteralPath $logPath -Encoding utf8
    Push-Location -LiteralPath $functionsRoot
    $pushed = $true
    # Windows PowerShell 5.1 wraps native stderr in ErrorRecord; capture it without losing the exit code.
    $ErrorActionPreference = 'Continue'
    & $node @arguments 2>&1 | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    $checkExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($null -eq $checkExit) { $checkExit = 1 }
    "Exit code: $checkExit" | Out-File -LiteralPath $logPath -Encoding utf8 -Append
    if ($checkExit -eq 0) {
        Write-Output "PASS (exit 0). Log: $logPath"
    } else {
        Get-Content -LiteralPath $logPath -Encoding UTF8 -Tail 25
        Write-Output "FAIL (exit $checkExit). Log: $logPath"
    }
} catch {
    Write-Output "本機檢查未完成：$($_.Exception.Message)"
    $checkExit = 1
} finally {
    if ($pushed) { Pop-Location }
    $env:PATH = $oldPath
    $env:LINE_OA_TEST_FILES_JSON = $oldSelection
    $OutputEncoding = $oldOutputEncoding
    [Console]::OutputEncoding = $oldConsoleEncoding
}
exit $checkExit
