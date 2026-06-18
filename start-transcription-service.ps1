$ErrorActionPreference = "Stop"
$extensionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceDir = Split-Path -Parent $extensionDir
$python = Join-Path $workspaceDir ".whisper-env\Scripts\python.exe"
$server = Join-Path $extensionDir "transcription_server.py"
$log = Join-Path $extensionDir "transcription-service.log"
$errorLog = Join-Path $extensionDir "transcription-service-error.log"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Whisper environment not found: $python"
}

$connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue
if ($connection) {
    Write-Host "Transcription service is already running on 127.0.0.1:18765."
    exit 0
}

Start-Process -FilePath $python `
    -ArgumentList @($server) `
    -WorkingDirectory $extensionDir `
    -RedirectStandardOutput $log `
    -RedirectStandardError $errorLog `
    -WindowStyle Hidden

Start-Sleep -Seconds 2
if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Transcription service started."
} else {
    throw "Transcription service failed to start. See $log"
}
