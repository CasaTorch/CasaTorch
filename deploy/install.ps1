# CasaTorch installer for Windows 10/11. Run in PowerShell as Administrator:
#
#   irm https://casatorch.com/install.ps1 | iex          # or, from a download:  .\deploy\install.ps1
#
# Installs Node.js LTS (winget) if needed, puts CasaTorch in C:\ProgramData\CasaTorch,
# starts it at boot (a scheduled task, even before anyone signs in), and opens
# port 8090 on private networks. Run it again to update; settings are kept.
#
# It installs the newest release (a version tag), never `main`, and checks every file against the release's
# checksums signed with CasaTorch's offline release key before anything is built or run. Releases made before 0.8.0
# have no signed file list: it says so and carries on ($env:CASATORCH_REQUIRE_SIGNED = '1' stops instead).
# Developers: $env:CASATORCH_REF = 'main' installs a branch, without the check.
$ErrorActionPreference = 'Stop'
$Repo   = if ($env:CASATORCH_REPO) { $env:CASATORCH_REPO } else { 'https://github.com/casatorch/casatorch' }
$Ref    = if ($env:CASATORCH_REF) { $env:CASATORCH_REF } elseif ($env:CASATORCH_BRANCH) { $env:CASATORCH_BRANCH } else { '' }
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
  if (-not $Ref) {   # the newest published release
    $r = Invoke-WebRequest "$Repo/releases/latest" -UseBasicParsing
    $final = if ($r.BaseResponse.ResponseUri) { $r.BaseResponse.ResponseUri.AbsoluteUri } else { $r.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
    if ($final -match '/releases/tag/([^/?#]+)') { $Ref = $Matches[1] } else { throw "Couldn't find the newest CasaTorch release - check the internet connection and try again." }
  }
  Say "Downloading CasaTorch $Ref"
  $zip = Join-Path $env:TEMP 'casatorch.zip'; $tmp = Join-Path $env:TEMP 'casatorch-src'; $rel = Join-Path $env:TEMP 'casatorch-release'
  Invoke-WebRequest "$Repo/archive/$Ref.zip" -OutFile $zip -UseBasicParsing
  Remove-Item -Recurse -Force $tmp, $rel -ErrorAction SilentlyContinue; Expand-Archive $zip $tmp
  $top = Get-ChildItem $tmp | Select-Object -First 1
  # Check the download against the signed release before anything of it runs.
  $rc = 3
  if ($Ref -match '^v\d+\.\d+\.\d+$') {
    Say 'Checking the download against CasaTorch''s signed release'
    New-Item -ItemType Directory -Force -Path $rel | Out-Null
    foreach ($f in 'SHA256SUMS', 'SHA256SUMS.sig', 'casatorch-source-files.sha256') {
      try { Invoke-WebRequest "$Repo/releases/download/$Ref/$f" -OutFile (Join-Path $rel $f) -UseBasicParsing } catch { }
    }
    $verifier = Join-Path $rel 'verify-release.js'
    Set-Content -Encoding UTF8 -Path $verifier -Value @'
// verify-release.js - checks a CasaTorch source tree against the release's signed checksums, before it is built or run.
// Used by deploy/install.sh, deploy/install.ps1 and the Home Assistant add-on build (keep the copies the same:
// app/test/security-unit.mjs checks). Needs Node.js 20+ only.
//
//   node verify-release.js <dir> <SHA256SUMS> <SHA256SUMS.sig> <casatorch-source-files.sha256> [<list of files>]
//
// SHA256SUMS must carry CasaTorch's offline release signature (Ed25519, the key below - the same one the Linux/Pi
// updater trusts), list casatorch-source-files.sha256 with the right checksum, and every file in that list must be in
// <dir> with the right checksum. With no <list of files>, <dir> must hold nothing else (a fresh download); with one
// (e.g. `git ls-files` of a checkout), that list must match exactly.
// Exit codes: 0 verified; 2 the release has no signed file list (made before 0.8.0); 1 anything else is wrong.
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const RELEASE_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAjZpfFYZVcjzY0N8vFCEfIX7l6t5E7SSRB6Cfe2LdzIY=\n-----END PUBLIC KEY-----\n';
const LIST = 'casatorch-source-files.sha256';
const stop = (msg, code = 1) => { process.stderr.write(`verify-release: ${msg}\n`); process.exit(code); };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sums = (txt) => new Map(String(txt).split('\n').map((l) => l.match(/^([0-9a-f]{64}) [ *](.+)$/)).filter(Boolean).map((m) => [m[2], m[1]]));
const [dir, sumsFile, sigFile, listFile, namesFile] = process.argv.slice(2);
if (!dir || !sumsFile || !sigFile || !listFile) stop('usage: verify-release.js <dir> <SHA256SUMS> <SHA256SUMS.sig> <file list> [names]');
const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
const S = read(sumsFile), G = read(sigFile);
if (!S || !G) stop('the release has no signed checksums', 2);
const key = process.env.CASATORCH_RELEASE_KEY_FILE ? fs.readFileSync(process.env.CASATORCH_RELEASE_KEY_FILE, 'utf8') : RELEASE_KEY;   // tests only
let good = false; try { good = crypto.verify(null, S, key, G); } catch { good = false; }
if (!good) stop('SHA256SUMS is not signed by CasaTorch\'s release key');
const signed = sums(S);
if (!signed.has(LIST)) stop('this release has no signed file list', 2);
const L = read(listFile);
if (!L || sha(L) !== signed.get(LIST)) stop(`${LIST} doesn't match the signed release`);
const want = sums(L);
if (!want.size) stop(`${LIST} is empty`);
for (const [name, h] of want) {
  const full = path.resolve(dir, name);
  if (!full.startsWith(path.resolve(dir) + path.sep)) stop(`bad path in the list: ${name}`);
  const b = read(full);
  if (!b) stop(`missing: ${name}`);
  if (sha(b) !== h) stop(`changed: ${name}`);
}
let have;
if (namesFile) have = String(read(namesFile) || '').split(/\r?\n/).filter(Boolean);
else {
  have = []; const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else have.push(r); } };
  walk(path.resolve(dir), '');
}
const extra = have.filter((n) => !want.has(n));
if (extra.length) stop(`not in the release: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ` and ${extra.length - 5} more` : ''}`);
if (have.length !== want.size) stop('the file list doesn\'t match the release');
process.stdout.write(`verified ${want.size} files against the signed release\n`);
'@
    & $NodeExe $verifier $top.FullName (Join-Path $rel 'SHA256SUMS') (Join-Path $rel 'SHA256SUMS.sig') (Join-Path $rel 'casatorch-source-files.sha256')
    $rc = $LASTEXITCODE
  }
  if ($rc -eq 1) { Remove-Item -Recurse -Force $tmp, $rel -ErrorAction SilentlyContinue; throw "The download doesn't match CasaTorch's signed release, so nothing was installed or changed. Try again later, or ask at support@casatorch.com." }
  if ($rc -ne 0) {
    if ($env:CASATORCH_REQUIRE_SIGNED -eq '1') { throw "$Ref has no signed file list to check (CASATORCH_REQUIRE_SIGNED=1)." }
    if ($rc -eq 2) { Say "Note: $Ref was released before signed file lists - installing it without that check" } else { Say "Note: $Ref is not a release - installing it without the signature check" }
  }
  robocopy $top.FullName $App /E /XD node_modules data /NFL /NDL /NJH /NJS | Out-Null
}

Say 'Installing and building'
Push-Location (Join-Path $App 'app')
& npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
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
