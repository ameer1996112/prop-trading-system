$ErrorActionPreference = "Stop"

function Get-TaskSha256([string]$value) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($value)) | ForEach-Object { $_.ToString("x2") })
    }
    finally {
        $sha.Dispose()
    }
}

$taskFilesRoot = Read-Host "Paste the MT5 MQL5\\Files folder path"
$taskBrokerServer = Read-Host "Enter the exact MT5 broker server name"
if ([string]::IsNullOrWhiteSpace($taskFilesRoot) -or [string]::IsNullOrWhiteSpace($taskBrokerServer)) {
    throw "The Files path and broker server name are required."
}

$taskBytes = New-Object byte[] 32
$taskRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $taskRandom.GetBytes($taskBytes)
}
finally {
    $taskRandom.Dispose()
}

$taskBearer = [Convert]::ToBase64String($taskBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
$taskConfigDir = Join-Path $taskFilesRoot "TradeOpsAgent\\local"
$taskConfigPath = Join-Path $taskConfigDir "config.ini"
$taskLines = @(
    "profile=DRY_RUN",
    "endpoint=https://prop-trading-execution-edge-dry-run.ameer-1996112.workers.dev/api/v1/agent/sync",
    "bearer=$taskBearer",
    "installation_id=windows-mt5-dryrun-001",
    "account_id=account-local-001",
    "account_profile_sha256=$(Get-TaskSha256 "account-profile|$taskBrokerServer")",
    "broker_server_sha256=$(Get-TaskSha256 $taskBrokerServer)",
    "ea_sha256=05197559af0e344712aecb012a2236521fccf53319128540654c7f57d623ca79",
    "manifest_sha256=5e67bb84770e413b19fbe27a9b44a0aec2a27bf6176815dc44506ba6b8b58cc0",
    "symbol_capability_sha256=445bb04e89aeee2a997f3a0aff744679941916d3ef5573c56bd5bfcd6d2cc137",
    "reconciliation_sha256=c1a07e65f4ac1b84990384b236ab9cb95b43167550e423ea91bbc10cd06b8b8c",
    "source_symbol=EURUSD",
    "safety_epoch=1"
)

New-Item -ItemType Directory -Path $taskConfigDir -Force | Out-Null
Set-Content -LiteralPath $taskConfigPath -Value $taskLines -Encoding ascii

Write-Host "Private DRY_RUN config created with one key per line."
Write-Host "Send only this SHA-256 to Codex; do not send the bearer or config file:"
Write-Output (Get-TaskSha256 $taskBearer)
