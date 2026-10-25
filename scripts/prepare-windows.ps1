param(
    [string]$AppAsar,
    [string]$OutputDirectory = 'scratch/asar'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedVersion = '26.1021.31345'
if (-not $AppAsar) {
    $desktop = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    if (-not $desktop) { throw 'Codex Desktop was not found. Pass -AppAsar with the path to its app.asar.' }
    $AppAsar = Join-Path $desktop.InstallLocation 'app/resources/app.asar'
}
$AppAsar = (Resolve-Path -LiteralPath $AppAsar).Path
$output = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
if (-not $output.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputDirectory must be inside this checkout.'
}
if (Test-Path -LiteralPath $output) { throw "Output already exists: $output. Move it to a backup or choose another -OutputDirectory." }
$gitExe = (Get-Command git.exe -ErrorAction Stop).Source
$gitRoot = Split-Path -Parent (Split-Path -Parent $gitExe)
$patchExe = Join-Path $gitRoot 'usr/bin/patch.exe'
if (-not (Test-Path -LiteralPath $patchExe)) { throw 'GNU patch from Git for Windows is required.' }
function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
Invoke-Checked (Join-Path $repoRoot 'node_modules/.bin/asar.cmd') @('extract', $AppAsar, $output)
$app = Get-Content -LiteralPath (Join-Path $output 'package.json') -Raw | ConvertFrom-Json
if ($app.version -ne $expectedVersion) { throw "Expected Desktop $expectedVersion, found $($app.version). Port patches before changing this pin." }
Copy-Item -Path 'assets/*' -Destination (Join-Path $output 'webview')
Invoke-Checked (Join-Path $repoRoot 'node_modules/.bin/sharp.cmd') @(
    '-i', (Join-Path $output 'webview/assets/app-f483cb0295ed.png'),
    '-o', (Join-Path $output 'webview/assets/pwa-icon-512.png'), '-f', 'png',
    'resize', '384', '384', '--fit', 'inside', '--', 'flatten', 'white', '--',
    'extend', '64', '64', '64', '64', '--background', 'white', '--', 'removeAlpha'
)
$prepareSource = Get-Content -LiteralPath 'scripts/prepare_asar' -Raw
$patches = [regex]::Matches($prepareSource, '< (patches/[^\s]+\.patch)') |
    ForEach-Object { Join-Path 'patches/windows' ([IO.Path]::GetFileName($_.Groups[1].Value)) }
$files = foreach ($patch in $patches) {
    [regex]::Matches((Get-Content -LiteralPath $patch -Raw), '(?m)^\+\+\+ b/([^\r\n]+)') |
        ForEach-Object { Join-Path $output $_.Groups[1].Value }
}
Invoke-Checked (Join-Path $repoRoot 'node_modules/.bin/prettier.cmd') (@('--ignore-path', '.prettierignore', '--write') + @($files | Sort-Object -Unique))
foreach ($patch in $patches) {
    Invoke-Checked $patchExe @('--batch', '--forward', '--strip', '1', '--directory', $output, '--input', (Join-Path $repoRoot $patch))
}
# Electron's SQLite binary uses another ABI. Resolve the host Node dependency.
$sqlite = [IO.Path]::GetFullPath((Join-Path $output 'node_modules/better-sqlite3'))
if (-not $sqlite.StartsWith($output + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe SQLite path.' }
if (Test-Path -LiteralPath $sqlite) { Remove-Item -LiteralPath $sqlite -Recurse -Force }
Write-Output "Prepared Codex Desktop $($app.version) in $output"
