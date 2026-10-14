# CasaTorch installer for Windows 10/11. Run in PowerShell as Administrator:
#
#   irm https://casatorch.com/install.ps1 | iex          # or, from a download:  .\deploy\install.ps1
#
# Installs Node.js LTS (winget) if needed, puts CasaTorch in C:\ProgramData\CasaTorch,
# starts it at boot (a scheduled task, even before anyone signs in), and opens
# port 8090 on private networks. Run it again to update; settings are kept.
$ErrorActionPreference = 'Stop'
$Repo   = if ($env:CASATORCH_REPO) { $env:CASATORCH_REPO } else { 'https://github.com/casatorch/casatorch' }
$Branch = if ($env:CASATORCH_BRANCH) { $env:CASATORCH_BRANCH } else { 'main' }
$Port   = if ($env:CASATORCH_PORT) { $env:CASATORCH_PORT } else { '8090' }
$Root   = Join-Path $env:ProgramData 'CasaTorch'
$App    = Join-Path $Root 'app'
$Data   = Join-Path $Root 'data'
function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Open PowerShell with "Run as administrator" and try again.'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node -or [int]((& node -p "process.versions.node.split('.')[0]")) -lt 20) {
  Say 'Installing Node.js LTS'
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
$NodeExe = (Get-Command node).Source
Say "Node.js $(& node -v)"

New-Item -ItemType Directory -Force -Path $Root, $Data | Out-Null
# Updating: stop the running copy first so its files are not in use.
Stop-ScheduledTask -TaskName 'CasaTorch' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$App\app\server.js*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($here -and (Test-Path (Join-Path $here '..\app\package.json'))) {
  Say 'Copying CasaTorch from this folder'
  $src = Resolve-Path (Join-Path $here '..')
  if (Test-Path $App) { Remove-Item -Recurse -Force (Join-Path $App 'app\src'), (Join-Path $App 'app\public') -ErrorAction SilentlyContinue }
  robocopy $src $App /E /XD node_modules data .git /NFL /NDL /NJH /NJS | Out-Null
} else {
  Say 'Downloading CasaTorch'
  $zip = Join-Path $env:TEMP 'casatorch.zip'; $tmp = Join-Path $env:TEMP 'casatorch-src'
  Invoke-WebRequest "$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip -UseBasicParsing
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue; Expand-Archive $zip $tmp
  $top = Get-ChildItem $tmp | Select-Object -First 1
  robocopy $top.FullName $App /E /XD node_modules data /NFL /NDL /NJH /NJS | Out-Null
}

Say 'Installing and building'
Push-Location (Join-Path $App 'app')
& npm ci --omit=dev --no-audit --no-fund --loglevel=error
& $NodeExe build.mjs | Out-Null
Pop-Location

# Settings hold passwords' hashes and device keys: only SYSTEM and Administrators may read them.
icacls $Data /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null

$run = Join-Path $Root 'run.cmd'
@"
@echo off
set CASATORCH_DATA_DIR=$Data
set PORT=$Port
set NODE_ENV=production
cd /d "$App\app"
"$NodeExe" "$App\app\server.js" >> "$Data\casatorch.log" 2>&1
"@ | Set-Content -Encoding ASCII $run

Say 'Starting CasaTorch at boot'
$action   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$run`""
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'CasaTorch' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'CasaTorch'

if (-not (Get-NetFirewallRule -DisplayName 'CasaTorch' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'CasaTorch' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null
}
Start-Sleep 3
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
Say "CasaTorch is running. Open http://${ip}:$Port on any screen at home to set it up."
Say "Log: $Data\casatorch.log   Update: run this installer again."
