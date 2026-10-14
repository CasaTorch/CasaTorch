; CasaTorch for Windows (Inno Setup 6). Built by .github/workflows/release.yml:
;   iscc /DAppVersion=0.3.0 deploy\packaging\windows\casatorch.iss
; Expects dist\bundle (deploy/packaging/bundle.sh) and dist\node-win\node.exe (fetch-node.sh win-x64).
; Installs to Program Files, keeps settings in C:\ProgramData\CasaTorch, and runs CasaTorch in the
; background as a scheduled task (Network Service account) that starts with Windows - before anyone signs in.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define Root "..\..\.."

[Setup]
AppId={{4C6F2B1E-8D3A-4E5B-9A7C-CA5A70C40001}
AppName=CasaTorch
AppVersion={#AppVersion}
AppVerName=CasaTorch {#AppVersion}
AppPublisher=CasaTorch
AppPublisherURL=https://casatorch.com
AppSupportURL=https://casatorch.com/download
DefaultDirName={autopf}\CasaTorch
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir={#Root}\dist
OutputBaseFilename=CasaTorch-Setup-Windows
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0
UninstallDisplayName=CasaTorch
CloseApplications=no

[Tasks]
Name: "desktopicon"; Description: "Put a CasaTorch shortcut on the desktop"

[Files]
Source: "{#Root}\dist\bundle\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#Root}\dist\node-win\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "casatorch-run.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "service.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\CasaTorch"; Filename: "http://localhost:8090/"
Name: "{autodesktop}\CasaTorch"; Filename: "http://localhost:8090/"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -AppDir ""{app}"""; StatusMsg: "Starting CasaTorch..."; Flags: runhidden waituntilterminated
Filename: "http://localhost:8090/"; Description: "Open CasaTorch and start setup"; Flags: postinstall shellexec nowait

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\service.ps1"" -AppDir ""{app}"" -Remove"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveCasaTorchTask"

[Code]
// Updating: stop the running copy first so its files can be replaced.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var Old: String; Code: Integer;
begin
  Result := '';
  Old := ExpandConstant('{autopf}\CasaTorch\service.ps1');
  if FileExists(Old) then
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -ExecutionPolicy Bypass -File "' + Old + '" -AppDir "' + ExtractFileDir(Old) + '" -Remove -KeepData', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
