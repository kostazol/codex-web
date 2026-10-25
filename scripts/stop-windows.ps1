$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $repoRoot 'scratch-runtime/server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { throw 'No saved server PID was found.' }
$serverProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
$server = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId"
if (-not $server) { Write-Output 'The saved server process has already stopped.'; return }
$expectedMain = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'src/server/main.js')).Path
if ($server.Name -ne 'node.exe' -or -not $server.CommandLine.Contains(('"{0}"' -f $expectedMain))) {
    throw 'The saved PID belongs to another process; refusing to stop it.'
}
Stop-Process -Id $serverProcessId
Write-Output "Stopped Codex Web (PID $serverProcessId)."
