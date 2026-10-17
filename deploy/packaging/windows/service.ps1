# Installs (or with -Remove, removes) the background task that runs CasaTorch.
#  - runs as Network Service (not an administrator), starts with Windows, restarts if it stops
#  - lets other devices on your home (private) network open http://<this PC>:8090
param([Parameter(Mandatory)][string]$AppDir, [switch]$Remove, [switch]$KeepData)
$ErrorActionPreference = 'Continue'
$Name = 'CasaTorch'
Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($AppDir, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($Remove) {
  Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
  if (-not $KeepData) { Remove-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue }
  exit 0   # settings in C:\ProgramData\CasaTorch are kept, so reinstalling picks up where you left off
}
$Data = Join-Path $env:ProgramData 'CasaTorch'
New-Item -ItemType Directory -Force -Path $Data | Out-Null
& icacls.exe $Data /grant '*S-1-5-20:(OI)(CI)M' | Out-Null   # Network Service may write its settings here
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/c `"`"$AppDir\casatorch-run.cmd`"`"" -WorkingDirectory "$AppDir\app"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-20' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Name -Description 'CasaTorch - one screen for your whole house (http://localhost:8090)' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
if (-not (Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort 8090,8443 -Action Allow -Profile Private,Domain | Out-Null
}
Start-ScheduledTask -TaskName $Name
for ($i = 0; $i -lt 40; $i++) { try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8090/api/health').StatusCode -eq 200) { break } } catch { Start-Sleep -Milliseconds 500 } }
