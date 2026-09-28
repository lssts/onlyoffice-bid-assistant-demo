param([string]$BackendHost = "", [string]$OnlyOfficeUrl = "http://10.174.202.82:9898")
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$frontendRoot = Join-Path $projectRoot 'frontend'
$runtimeRoot = Join-Path $projectRoot 'runtime'
$pythonExe = Join-Path $backendRoot '.venv\Scripts\python.exe'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

if (-not (Test-Path -LiteralPath $pythonExe)) {
    & python -m venv (Join-Path $backendRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Python virtual environment creation failed.' }
    & $pythonExe -m pip install -r (Join-Path $backendRoot 'requirements.lock.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $backendRoot '.env'))) {
    $configArgs = @((Join-Path $projectRoot 'scripts\configure.py'), '--onlyoffice-url', $OnlyOfficeUrl)
    if ($BackendHost) { $configArgs += @('--backend-host', $BackendHost) }
    & $pythonExe @configArgs
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure LAN access.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot 'node_modules'))) {
    Push-Location $frontendRoot
    try { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Frontend install failed.' } }
    finally { Pop-Location }
}

if (-not (Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue)) {
    $backendProcess = Start-Process -FilePath $pythonExe -ArgumentList @('-m','uvicorn','app:app','--host','0.0.0.0','--port','8010','--no-access-log') -WorkingDirectory $backendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'backend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'backend.err.log')
    $backendProcess.Id | Set-Content (Join-Path $runtimeRoot 'backend.pid')
    Write-Host "Started Python backend, PID $($backendProcess.Id)"
} else { Write-Host 'Port 8010 already listening; existing process left unchanged.' }
if (-not (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)) {
    $nodeExe = (Get-Command node.exe).Source
    $frontendProcess = Start-Process -FilePath $nodeExe -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'frontend.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'frontend.err.log')
    $frontendProcess.Id | Set-Content (Join-Path $runtimeRoot 'frontend.pid')
    Write-Host "Started Vue frontend, PID $($frontendProcess.Id)"
} else { Write-Host 'Port 5173 already listening; existing process left unchanged.' }
Write-Host 'Open http://127.0.0.1:5173'
Write-Host 'This script does not reset or repair the ONLYOFFICE container.'
