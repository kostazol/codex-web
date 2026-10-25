# Run as administrator. WSL serves HTTPS directly; Windows uses a loopback
# hosts entry, matching the existing local-v2/local-v3 convention.
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell session.'
}
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$hostsText = [IO.File]::ReadAllText($hostsPath)
$domainLines = $hostsText -split '\r?\n' | Where-Object { ($_ -split '#', 2)[0] -match '(^|\s)web-codex\.duckdns\.org(\s|$)' }
if ($domainLines -and @($domainLines | Where-Object { $_ -notmatch '^\s*127\.0\.0\.1\s' }).Count) {
    throw 'An existing hosts entry points this domain elsewhere. Inspect it before replacing.'
}
if (-not $domainLines) {
    $hostsBackup = $hostsPath + '.before-codex-web-https-20261025'
    if (-not (Test-Path -LiteralPath $hostsBackup)) { Copy-Item -LiteralPath $hostsPath -Destination $hostsBackup }
    [IO.File]::AppendAllText($hostsPath,"`r`n127.0.0.1 web-codex.duckdns.org # Codex Web on mirrored WSL`r`n",[Text.UTF8Encoding]::new($false))
}
# Remove only this setup's unsuccessful experimental mappings.
$proxyTable = netsh interface portproxy show v4tov4
foreach ($entry in @(@{ Listen='127.0.0.1'; Target=8445 }, @{ Listen='192.168.5.110'; Target=8444 })) {
    $addressPattern = [regex]::Escape($entry.Listen)
    $existing = $proxyTable | Select-String "^$addressPattern\s+443\s+"
    if ($existing) {
        if ($existing.Line -notmatch "\s+127\.0\.0\.1\s+$($entry.Target)\s*$") { throw 'An unrelated port proxy must not be removed.' }
        netsh interface portproxy delete v4tov4 "listenaddress=$($entry.Listen)" listenport=443
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the obsolete HTTPS mapping.' }
    }
}
$ruleName = 'CodexWeb-HTTPS-443-20261025'
if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $ruleName -DisplayName 'Codex Web HTTPS LAN and VPN TCP 443' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress 192.168.5.110 -LocalPort 443 -RemoteAddress 192.168.5.0/24,192.168.1.0/24,10.20.0.1,10.20.0.2 -Profile Private -InterfaceAlias 'Ethernet 6' | Out-Null
}
Clear-DnsClientCache
Write-Output 'Codex Web local DNS and LAN/VPN HTTPS firewall configured.'