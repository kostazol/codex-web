param(
    [string]$ListenAddress = '127.0.0.1',
    [ValidateRange(1,65535)][int]$Port = 8214,
    [string]$CodexCliPath,
    [ValidateSet('electron','node')][string]$NetworkTransport = 'electron'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$main = Join-Path $repoRoot 'src/server/main.js'
$env:CODEX_WEB_NETWORK_TRANSPORT = $NetworkTransport
if ($NetworkTransport -eq 'electron' -and -not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules/electron/dist/electron.exe'))) {
    throw 'Install the Electron network runtime with: npm.cmd rebuild electron'
}
if (-not (Test-Path -LiteralPath $main)) { throw 'Run npm run build:server and npm run build:browser first.' }
if (-not $CodexCliPath) {
    $desktop = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
    if ($desktop) { $CodexCliPath = Join-Path $desktop.InstallLocation 'app/resources/codex.exe' }
}
if ($CodexCliPath) {
    $env:CODEX_CLI_PATH = (Resolve-Path -LiteralPath $CodexCliPath).Path
}
if (-not $env:CODEX_CLI_PATH) { throw 'Codex Desktop was not found. Pass -CodexCliPath with its bundled CLI path.' }
$cliVersion = (& $env:CODEX_CLI_PATH --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $cliVersion -ne 'codex-cli 0.164.0-alpha.11.1') {
    throw "Expected codex-cli 0.164.0-alpha.11.1, found '$cliVersion'. Update the Desktop patches and CLI pin together."
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already in use." }
$runtime = Join-Path $repoRoot 'scratch-runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$server = Start-Process -FilePath (Get-Command node.exe).Source `
    -ArgumentList @(('"{0}"' -f $main), '--host', $ListenAddress, '--port', $Port) `
    -WorkingDirectory $repoRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtime 'server.out.log') `
    -RedirectStandardError (Join-Path $runtime 'server.err.log') -PassThru
$server.Id | Set-Content -LiteralPath (Join-Path $runtime 'server.pid')
$probeAddress = if ($ListenAddress -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $ListenAddress }
$probeUrl = "http://${probeAddress}:$Port/"
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $server.Refresh()
    if ($server.HasExited) { throw "Server exited. Inspect $runtime/server.err.log." }
    try {
        $response = Invoke-WebRequest -Uri $probeUrl -TimeoutSec 1 -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Output "Codex Web: $probeUrl (PID $($server.Id))"
            return
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw "Server PID $($server.Id) is running but did not become ready. Inspect $runtime/server.err.log."
