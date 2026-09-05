; ================================================================
;  BioVisitor X — Inno Setup Installer Script
;  Empresa   : Suprema LATAM
;  Producto  : BioVisitor X v1.0.0
;  Plataforma: Windows 10/11/Server 2016+  (x64)
;
;  Instala:
;   - Node.js 24 LTS (si no está)
;   - PostgreSQL 16 (unattended)
;   - Redis for Windows (servicio)
;   - Backend NestJS (.exe via pkg)
;   - Frontend Next.js standalone (HTTPS nativo)
;   - Certificado SSL autofirmado (7 años, Suprema LATAM)
;   - Servicios Windows via NSSM:
;       "Suprema LATAM BioVisitor Service"
;       "Suprema LATAM BioVisitor Web GUI"
;
;  Wizard custom:
;   - Credenciales PostgreSQL
;   - Selección de interfaz de red (multi-NIC)
;   - Detección + edición de puertos en conflicto
;   - Configuración SMTP (opcional)
;
;  Desinstalación:
;   - Dialog para conservar o eliminar la BD
;   - Elimina servicios, firewall, opccionalmente datos
; ================================================================

; ── Constantes editables ─────────────────────────────────────
#define AppName           "BioVisitor X"
#define AppVersion        "1.0.0"
#define AppPublisher      "Suprema LATAM"
#define AppURL            "https://www.suprema.co"
#define AppSupportURL     "https://www.suprema.co/soporte"
#define AppContact        "soporte@suprema.co"

; GUID fijo de identidad del producto — NO cambiar entre versiones.
; Es lo que permite detectar una instalación previa (InitializeSetup) y
; lo que el Administrador de Puertos/Servicios usa para ubicar el
; directorio de instalación vía el registro de desinstalación de Windows.
#define AppIdGuid         "{A9E9D1B4-6C3E-4B8F-9A1D-5F2E7C8B0A31}"

; Nombres de servicios Windows (no cambiar — scripts de gestión los usan)
#define SvcBackend        "Suprema LATAM BioVisitor Service"
#define SvcFrontend       "Suprema LATAM BioVisitor Web GUI"

; Nombre de servicio dedicado para "nuestro" PostgreSQL — deliberadamente
; distinto del nombre genérico "postgresql-x64-16" que usa el instalador
; oficial de EDB por defecto. Un nombre y un puerto propios permiten al
; BioVisitor Admin Tool (Rust) identificar sin ambigüedad esta instancia
; y operarla con seguridad (start/stop/restart/cambio de puerto), incluso
; en un servidor que ya tenga otro PostgreSQL genérico instalado para otra
; aplicación.
#define PgServiceName     "BioVisitor Database Service"
#define DefaultDbPort     "55432"

; Redistribuibles — actualizar si cambias versiones
#define PostgreSQLInstaller  "postgresql-16.14-2-windows-x64.exe"
#define RedisInstaller       "Redis-x64-5.0.14.1.msi"
#define NodeInstaller        "node-v24.19.0-x64.msi"
#define PostgreSQLVersion    "16"

; ── Configuración del installer ──────────────────────────────
[Setup]
AppId={{#AppIdGuid}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppSupportURL}
AppContact={#AppContact}
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=Sistema de Gestión de Visitantes - {#AppPublisher}

DefaultDirName={commonpf}\SupremaLATAM\BioVisitor
DefaultGroupName=Suprema LATAM\BioVisitor X
AllowNoIcons=yes
LicenseFile=License.txt
OutputDir=..\output
OutputBaseFilename=BioVisitorX-Setup-{#AppVersion}

; Icono del installer — coloca biovisitor.ico en windows-deployment\assets\
; Si no existe, comenta la línea siguiente o el compilador dará error.
; SetupIconFile=..\assets\biovisitor.ico

Compression=lzma2/ultra64
SolidCompression=yes
InternalCompressLevel=ultra64

PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

DisableWelcomePage=no
DisableDirPage=no
DisableProgramGroupPage=yes
DisableReadyPage=no

UninstallDisplayName={#AppName} — {#AppPublisher}
WizardStyle=modern

MinVersion=10.0.14393

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear acceso directo en el &Escritorio"; \
  GroupDescription: "Accesos directos:"; Flags: checkedonce

; ── Archivos a incluir ───────────────────────────────────────
[Files]
; Backend EXE (compilado con pkg)
Source: "..\..\biovisitor-backend\biovisitor-backend.exe"; \
  DestDir: "{app}\backend"; Flags: skipifsourcedoesntexist ignoreversion

; Frontend standalone
Source: "..\..\biovisitor-frontend\.next\standalone\*"; \
  DestDir: "{app}\frontend"; Flags: recursesubdirs createallsubdirs

; Wrapper HTTPS del frontend (termina TLS y hace proxy al server.js interno de Next.js)
Source: "..\assets\server-https.js"; DestDir: "{app}\frontend"; Flags: ignoreversion

; Herramientas
Source: "..\tools\nssm.exe"; DestDir: "{app}\tools"; Flags: ignoreversion

; Scripts de gestión
Source: "..\scripts\3-start-all.bat";        DestDir: "{app}\scripts"
Source: "..\scripts\stop-all.bat";           DestDir: "{app}\scripts"
Source: "..\scripts\restart-all.bat";        DestDir: "{app}\scripts"
Source: "..\scripts\status.bat";             DestDir: "{app}\scripts"
Source: "..\scripts\uninstall-services.bat"; DestDir: "{app}\scripts"

; Base de datos
Source: "..\db\schema.sql"; DestDir: "{app}\db"
Source: "..\db\seed.sql";   DestDir: "{app}\db"

; Notas de versión (se muestran en el wizard)
Source: "RELEASE_NOTES.txt"; DestDir: "{app}"

; Redistribuibles (se eliminan tras instalación)
Source: "..\redist\{#PostgreSQLInstaller}"; DestDir: "{tmp}"; \
  Flags: deleteafterinstall skipifsourcedoesntexist
Source: "..\redist\{#RedisInstaller}"; DestDir: "{tmp}"; \
  Flags: deleteafterinstall skipifsourcedoesntexist
Source: "..\redist\{#NodeInstaller}"; DestDir: "{tmp}"; \
  Flags: deleteafterinstall skipifsourcedoesntexist

; ── Iconos y accesos directos ────────────────────────────────
[Icons]
Name: "{commondesktop}\BioVisitor X"; \
  Filename: "{app}\BioVisitor.url"; Tasks: desktopicon
Name: "{group}\BioVisitor X — Abrir en navegador"; \
  Filename: "{app}\BioVisitor.url"
Name: "{group}\Iniciar servicios"; \
  Filename: "{app}\scripts\3-start-all.bat"
Name: "{group}\Detener servicios"; \
  Filename: "{app}\scripts\stop-all.bat"
Name: "{group}\Estado servicios"; \
  Filename: "{app}\scripts\status.bat"
Name: "{group}\Notas de versión"; \
  Filename: "{app}\RELEASE_NOTES.txt"
Name: "{group}\Desinstalar BioVisitor X"; \
  Filename: "{uninstallexe}"

; ── Ejecutar al final ────────────────────────────────────────
[Run]
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -Command ""Start-Sleep 8"""; \
  Flags: runhidden; StatusMsg: "Esperando que los servicios arranquen..."
Filename: "{app}\BioVisitor.url"; \
  Description: "Abrir BioVisitor X en el navegador ahora"; \
  Flags: postinstall nowait shellexec skipifsilent unchecked

; ── Desinstalación ───────────────────────────────────────────
[UninstallRun]
Filename: "{app}\tools\nssm.exe"; \
  Parameters: "stop ""{#SvcFrontend}"""; \
  Flags: runhidden; RunOnceId: "StopFrontend"
Filename: "{app}\tools\nssm.exe"; \
  Parameters: "stop ""{#SvcBackend}"""; \
  Flags: runhidden; RunOnceId: "StopBackend"
Filename: "{app}\tools\nssm.exe"; \
  Parameters: "remove ""{#SvcFrontend}"" confirm"; \
  Flags: runhidden; RunOnceId: "RemoveFrontend"
Filename: "{app}\tools\nssm.exe"; \
  Parameters: "remove ""{#SvcBackend}"" confirm"; \
  Flags: runhidden; RunOnceId: "RemoveBackend"
Filename: "netsh.exe"; \
  Parameters: "advfirewall firewall delete rule name=""BioVisitor HTTPS"""; \
  Flags: runhidden; RunOnceId: "FwHTTPS"
Filename: "netsh.exe"; \
  Parameters: "advfirewall firewall delete rule name=""BioVisitor HTTP"""; \
  Flags: runhidden; RunOnceId: "FwHTTP"

; ══════════════════════════════════════════════════════════════
;  CÓDIGO PASCAL — Toda la lógica del wizard
; ══════════════════════════════════════════════════════════════
[Code]

// ─── Importaciones de la API de Windows ────────────────────────────────────
// SetEnvironmentVariable no es una función incorporada de Pascal Script de
// Inno Setup — hay que importarla de kernel32.dll para poder usarla (aquí,
// para pasarle PGPASSWORD a psql.exe sin pedirla de forma interactiva).

function SetEnvironmentVariable(lpName, lpValue: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';


// IfThen (de Delphi's StrUtils) tampoco existe en Pascal Script de Inno Setup.
function IfThen(Cond: Boolean; TrueVal, FalseVal: String): String;
begin
  if Cond then Result := TrueVal else Result := FalseVal;
end;


// ─── Variables globales ────────────────────────────────────────────────────

var
  // ── Páginas custom del wizard ─────────────────────────────
  PageDbCreds:   TInputQueryWizardPage;   // Credenciales PostgreSQL
  PageNicSelect: TWizardPage;             // Selección de interfaz de red
  PagePorts:     TInputQueryWizardPage;   // Configuración de puertos
  PageSmtp:      TInputQueryWizardPage;   // Configuración SMTP (opcional)

  // ── Controles de la página NIC ────────────────────────────
  NicListBox:    TNewListBox;
  NicLabel:      TNewStaticText;
  NicHint:       TNewStaticText;

  // ── Datos detectados ──────────────────────────────────────
  DetectedCountry: String;
  NicIPList:       TStringList;

  // ── Puertos efectivos ─────────────────────────────────────
  PortHTTPS: Integer;
  PortHTTP:  Integer;
  PortAPI:   Integer;
  PortDB:    Integer;
  HasPortConflict: Boolean;

  // ── PostgreSQL ────────────────────────────────────────────
  PgBinPath: String;

  // ── Detección de instalación previa (modo actualización) ───
  IsUpgradeMode:   Boolean;
  PriorInstallDir: String;
  PriorDbPassword: String;
  PriorDbPort:     String;


// ─── Utilidades PowerShell ─────────────────────────────────────────────────

function RunPS(Script: String): String;
var
  TmpFile: String;
  Lines:   TArrayOfString;
  RC:      Integer;
begin
  TmpFile := ExpandConstant('{tmp}\bvx_ps_out.txt');
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "' + Script +
    ' | Out-File -FilePath ''' + TmpFile + ''' -Encoding ASCII -NoNewline"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
  Result := '';
  if LoadStringsFromFile(TmpFile, Lines) then
    if GetArrayLength(Lines) > 0 then
      Result := Trim(Lines[0]);
end;

function RunPSLines(Script: String): TStringList;
var
  TmpFile: String;
  Lines:   TArrayOfString;
  RC, I:   Integer;
begin
  Result  := TStringList.Create;
  TmpFile := ExpandConstant('{tmp}\bvx_ps_lines.txt');
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -Command "' + Script +
    ' | Out-File -FilePath ''' + TmpFile + ''' -Encoding ASCII"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
  if LoadStringsFromFile(TmpFile, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do
      if Trim(Lines[I]) <> '' then
        Result.Add(Trim(Lines[I]));
end;

function RunPSFile(Content: String): Integer;
var
  TmpScript: String;
  RC:        Integer;
begin
  TmpScript := ExpandConstant('{tmp}\bvx_script.ps1');
  SaveStringToFile(TmpScript, Content, False);
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + TmpScript + '"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
  Result := RC;
end;

// Generador de hex aleatorio en Pascal puro — respaldo si PowerShell no está
// disponible o RunPS no devuelve un valor utilizable, para que un secreto de
// seguridad (JWT_SECRET, ENCRYPTION_MASTER_KEY, QR_JWT_SECRET) nunca quede
// vacío ni con un valor predecible en el .env generado.
function RandomHex(NumChars: Integer): String;
var
  I:      Integer;
  Digits: String;
begin
  Digits := '0123456789abcdef';
  Result := '';
  for I := 1 to NumChars do
    Result := Result + Digits[Random(16) + 1];
end;


// ─── Detección de país del SO ──────────────────────────────────────────────

function DetectCountry: String;
var CC: String;
begin
  CC := RunPS('[System.Globalization.RegionInfo]::CurrentRegion.TwoLetterISORegionName');
  if (Length(CC) = 2) and (CC <> '') then Result := UpperCase(CC)
  else Result := 'US';
end;


// ─── Enumeración de interfaces de red ─────────────────────────────────────

procedure PopulateNicList;
var
  IPs: TStringList;
  I:   Integer;
  IP:  String;
begin
  NicListBox.Items.Clear;
  NicIPList.Clear;

  IPs := RunPSLines(
    'Get-NetIPAddress -AddressFamily IPv4 | ' +
    'Where-Object { $_.IPAddress -ne ''127.0.0.1'' -and $_.PrefixOrigin -ne ''WellKnown'' } | ' +
    'Select-Object -ExpandProperty IPAddress');

  for I := 0 to IPs.Count - 1 do
  begin
    IP := IPs[I];
    if IP <> '' then
    begin
      NicIPList.Add(IP);
      NicListBox.Items.Add(IP);
    end;
  end;
  IPs.Free;

  if NicListBox.Items.Count > 0 then
    NicListBox.ItemIndex := 0
  else
  begin
    NicListBox.Items.Add('127.0.0.1  (solo local)');
    NicIPList.Add('127.0.0.1');
    NicListBox.ItemIndex := 0;
  end;
end;


// ─── Detección de conflictos de puertos ───────────────────────────────────

function IsPortInUse(Port: Integer): Boolean;
var RC: Integer;
begin
  Exec('powershell.exe',
    Format('-NoProfile -Command "if ((Get-NetTCPConnection -LocalPort %d ' +
           '-State Listen -ErrorAction SilentlyContinue) -ne $null) { exit 0 } else { exit 1 }"', [Port]),
    '', SW_HIDE, ewWaitUntilTerminated, RC);
  Result := (RC = 0);
end;

procedure CheckPortConflicts;
begin
  HasPortConflict := False;
  PortHTTPS := 443;  PortHTTP := 80;  PortAPI := 3001;  PortDB := StrToInt('{#DefaultDbPort}');

  if IsPortInUse(443)  then begin HasPortConflict := True; PortHTTPS := 8443; PagePorts.Values[0] := '8443'; end
                        else PagePorts.Values[0] := '443';
  if IsPortInUse(80)   then begin HasPortConflict := True; PortHTTP  := 8080; PagePorts.Values[1] := '8080'; end
                        else PagePorts.Values[1] := '80';
  if IsPortInUse(3001) then begin HasPortConflict := True; PortAPI   := 3002; PagePorts.Values[2] := '3002'; end
                        else PagePorts.Values[2] := '3001';
  if IsUpgradeMode then
  begin
    // El puerto real de escucha de PostgreSQL no se puede cambiar aquí
    // (requeriría editar postgresql.conf, no solo el .env) — se conserva
    // el que ya está configurado. Cambiarlo de forma segura es tarea del
    // BioVisitor Admin Tool, que sí coordina postgresql.conf + .env +
    // reinicio del servicio.
    PortDB := StrToIntDef(PriorDbPort, PortDB);
    PagePorts.Values[3] := IntToStr(PortDB);
  end
  else
  begin
    // PortDB ya arranca en un valor no genérico (55432) precisamente para
    // minimizar la chance de chocar con otro PostgreSQL en el servidor,
    // pero igual se verifica por si acaso.
    if IsPortInUse(PortDB) then begin HasPortConflict := True; PortDB := PortDB + 1; PagePorts.Values[3] := IntToStr(PortDB); end
                            else PagePorts.Values[3] := IntToStr(PortDB);
  end;
end;


// ─── Node.js ───────────────────────────────────────────────────────────────

function NodeIsInstalled: Boolean;
var RC: Integer;
begin
  Exec('node.exe', '--version', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Result := (RC = 0);
end;

function GetNodeExePath: String;
begin
  Result := RunPS('(Get-Command node -ErrorAction SilentlyContinue).Source');
  if Result = '' then Result := 'node.exe';
end;


// ─── PostgreSQL ────────────────────────────────────────────────────────────

function FindPgBin: String;
var P16, P15, P14: String;
begin
  P16 := ExpandConstant('{commonpf}') + '\PostgreSQL\{#PostgreSQLVersion}\bin';
  P15 := ExpandConstant('{commonpf}') + '\PostgreSQL\15\bin';
  P14 := ExpandConstant('{commonpf}') + '\PostgreSQL\14\bin';
  if DirExists(P16) then Result := P16
  else if DirExists(P15) then Result := P15
  else if DirExists(P14) then Result := P14
  else Result := '';
end;


// ─── Obtener IP seleccionada ───────────────────────────────────────────────

function GetSelectedIP: String;
var Idx: Integer;
begin
  Idx := NicListBox.ItemIndex;
  if (Idx >= 0) and (Idx < NicIPList.Count) then Result := NicIPList[Idx]
  else Result := '127.0.0.1';
end;


// ─── Generación del certificado SSL ───────────────────────────────────────

procedure GenerateSSLCert(InstallDir, SelectedIP, CountryCode: String);
var
  CertDir:     String;
  OpenSSLExe:  String;
  ConfFile:    String;
  ConfContent: String;
  PSScript:    String;
  RC:          Integer;
begin
  CertDir := InstallDir + '\frontend\cert';
  ForceDirectories(CertDir);

  // Buscar OpenSSL
  OpenSSLExe := '';
  if FileExists('C:\Program Files\Git\usr\bin\openssl.exe') then
    OpenSSLExe := 'C:\Program Files\Git\usr\bin\openssl.exe'
  else if FileExists('C:\Program Files\OpenSSL-Win64\bin\openssl.exe') then
    OpenSSLExe := 'C:\Program Files\OpenSSL-Win64\bin\openssl.exe';
  if OpenSSLExe = '' then
  begin
    Exec('where.exe', 'openssl', '', SW_HIDE, ewWaitUntilTerminated, RC);
    if RC = 0 then OpenSSLExe := 'openssl';
  end;

  if OpenSSLExe <> '' then
  begin
    // OpenSSL disponible
    ConfFile := ExpandConstant('{tmp}\bvx_ssl.cnf');
    ConfContent :=
      '[req]' + #13#10 +
      'default_bits=2048' + #13#10 +
      'default_md=sha256' + #13#10 +
      'prompt=no' + #13#10 +
      'distinguished_name=dn' + #13#10 +
      'x509_extensions=v3' + #13#10 + #13#10 +
      '[dn]' + #13#10 +
      'C=' + CountryCode + #13#10 +
      'ST=LATAM' + #13#10 +
      'L=LATAM' + #13#10 +
      'O=Suprema LATAM' + #13#10 +
      'OU=BioVisitor' + #13#10 +
      'CN=' + SelectedIP + #13#10 + #13#10 +
      '[v3]' + #13#10 +
      'subjectAltName=@alt' + #13#10 +
      'keyUsage=critical,digitalSignature,keyEncipherment' + #13#10 +
      'extendedKeyUsage=serverAuth' + #13#10 +
      'basicConstraints=CA:FALSE' + #13#10 + #13#10 +
      '[alt]' + #13#10 +
      'IP.1=127.0.0.1' + #13#10 +
      'DNS.1=localhost' + #13#10 +
      'IP.2=' + SelectedIP + #13#10;
    SaveStringToFile(ConfFile, ConfContent, False);

    Exec(OpenSSLExe,
      'req -x509 -newkey rsa:2048 -sha256 -days 2555 -nodes' +
      ' -keyout "' + CertDir + '\server.key"' +
      ' -out "'    + CertDir + '\server.crt"' +
      ' -config "' + ConfFile + '"',
      '', SW_HIDE, ewWaitUntilTerminated, RC);
  end
  else
  begin
    // Fallback: PowerShell New-SelfSignedCertificate
    PSScript :=
      '$ip = ''' + SelectedIP + '''' + #13#10 +
      '$d  = ''' + CertDir + '''' + #13#10 +
      '$c  = New-SelfSignedCertificate -Subject "CN=$ip,O=Suprema LATAM,OU=BioVisitor,C=' + CountryCode + '" ' +
      '  -DnsName "localhost" -NotAfter (Get-Date).AddYears(7) ' +
      '  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 ' +
      '  -TextExtension @("2.5.29.17={text}IPAddress=$ip&DNSName=localhost&IPAddress=127.0.0.1") ' +
      '  -CertStoreLocation "Cert:\LocalMachine\My" -KeyExportPolicy Exportable' + #13#10 +
      '$cp = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($c.RawData,"InsertLineBreaks") + "`n-----END CERTIFICATE-----"' + #13#10 +
      '[IO.File]::WriteAllText("$d\server.crt", $cp)' + #13#10 +
      '$r  = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c)' + #13#10 +
      '$kp = "-----BEGIN RSA PRIVATE KEY-----`n" + [Convert]::ToBase64String($r.ExportRSAPrivateKey(),"InsertLineBreaks") + "`n-----END RSA PRIVATE KEY-----"' + #13#10 +
      '[IO.File]::WriteAllText("$d\server.key", $kp)';
    RunPSFile(PSScript);
  end;

  // Importar al almacén Root de Windows
  Exec('certutil.exe',
    '-addstore -f "Root" "' + CertDir + '\server.crt"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
end;


// ─── Instalación de PostgreSQL ─────────────────────────────────────────────

procedure InstallPostgreSQL(SuperPass: String);
var
  Installer: String;
  RC:        Integer;
begin
  Installer := ExpandConstant('{tmp}') + '\{#PostgreSQLInstaller}';
  if not FileExists(Installer) then Exit;

  WizardForm.StatusLabel.Caption := 'Instalando PostgreSQL 16 (puede tardar varios minutos)...';
  Exec(Installer,
    '--mode unattended --superpassword "' + SuperPass + '"' +
    ' --servicename "{#PgServiceName}"' +
    ' --serverport ' + IntToStr(PortDB) + ' --unattendedmodeui minimal' +
    ' --disable-components stackbuilder',
    '', SW_HIDE, ewWaitUntilTerminated, RC);

  // Esperar a que PostgreSQL arranque (máx 60 seg)
  Exec('powershell.exe',
    '-NoProfile -Command "1..30 | ForEach-Object { Start-Sleep 2; ' +
    'if ((Get-Service ''{#PgServiceName}'' -ErrorAction SilentlyContinue).Status -eq ''Running'') { exit 0 } }; exit 1"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);

  PgBinPath := FindPgBin;
end;

procedure CreateDatabase(SuperPass: String);
var
  PsqlExe: String;
  RC:      Integer;
begin
  if PgBinPath = '' then PgBinPath := FindPgBin;
  if PgBinPath = '' then begin
    MsgBox('No se encontró psql.exe. Configura la BD manualmente.', mbError, MB_OK);
    Exit;
  end;

  PsqlExe := PgBinPath + '\psql.exe';
  SetEnvironmentVariable('PGPASSWORD', SuperPass);

  // BioVisitor se conecta directamente con el superusuario "postgres"
  // (sin rol de aplicación aparte) para evitar problemas de privilegios
  // sobre el esquema "public" — desde PostgreSQL 15 ya no se concede
  // CREATE en "public" a roles no-propietarios por defecto.
  Exec(PgBinPath + '\createdb.exe',
    '-U postgres -h 127.0.0.1 -p ' + IntToStr(PortDB) + ' biovisitor_db',
    '', SW_HIDE, ewWaitUntilTerminated, RC);

  WizardForm.StatusLabel.Caption := 'Creando tablas (schema.sql)...';
  Exec(PsqlExe,
    '-U postgres -h 127.0.0.1 -p ' + IntToStr(PortDB) + ' -d biovisitor_db -f "' + WizardDirValue + '\db\schema.sql"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);

  WizardForm.StatusLabel.Caption := 'Cargando datos iniciales (seed.sql)...';
  Exec(PsqlExe,
    '-U postgres -h 127.0.0.1 -p ' + IntToStr(PortDB) + ' -d biovisitor_db -f "' + WizardDirValue + '\db\seed.sql"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);

  SetEnvironmentVariable('PGPASSWORD', '');
end;


// ─── Instalación de Redis ──────────────────────────────────────────────────

procedure InstallRedis;
var
  Msi: String;
  RC:  Integer;
begin
  Msi := ExpandConstant('{tmp}') + '\{#RedisInstaller}';
  if not FileExists(Msi) then begin
    MsgBox('Instalador de Redis no encontrado.' + #13#10 +
           'Descárgalo desde https://github.com/tporadowski/redis/releases' + #13#10 +
           'y colócalo en windows-deployment\redist\ antes de recompilar el installer.',
           mbError, MB_OK);
    Exit;
  end;
  WizardForm.StatusLabel.Caption := 'Instalando Redis for Windows...';
  Exec('msiexec.exe', '/i "' + Msi + '" /quiet /norestart ADDLOCAL=ALL',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
end;


// ─── Instalación de Node.js ────────────────────────────────────────────────

procedure InstallNodeJS;
var
  Msi: String;
  RC:  Integer;
begin
  if NodeIsInstalled then Exit;
  Msi := ExpandConstant('{tmp}') + '\{#NodeInstaller}';
  if not FileExists(Msi) then Exit;
  WizardForm.StatusLabel.Caption := 'Instalando Node.js 24 LTS...';
  Exec('msiexec.exe', '/i "' + Msi + '" /quiet /norestart ADDLOCAL=ALL',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
end;


// ─── Generación del .env del backend ──────────────────────────────────────

procedure WriteBackendEnv(InstallDir, SuperPass, SelectedIP: String);
var
  EnvPath:    String;
  JwtSecret:  String;
  EncKey:     String;
  QrSecret:   String;
  SmtpHost:   String;
  SmtpPort:   String;
  SmtpUser:   String;
  SmtpPass:   String;
  SmtpFrom:   String;
  SmtpName:   String;
  EnvContent: String;
begin
  EnvPath := InstallDir + '\backend\.env';

  // Secrets aleatorios — generados con el generador criptográfico de
  // PowerShell; si por lo que sea PowerShell no está disponible o no
  // devuelve un valor utilizable, se usa RandomHex como respaldo para
  // que estos secretos de seguridad NUNCA queden vacíos.
  JwtSecret := RunPS('[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(64))');
  if Length(JwtSecret) < 32 then JwtSecret := RandomHex(88);

  EncKey := RunPS('[System.BitConverter]::ToString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).Replace(''-'','''')');
  if Length(EncKey) <> 64 then EncKey := RandomHex(64);

  QrSecret := RunPS('[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))');
  if Length(QrSecret) < 32 then QrSecret := RandomHex(64);

  // Valores SMTP del wizard
  SmtpHost := Trim(PageSmtp.Values[0]);
  SmtpPort := Trim(PageSmtp.Values[1]);
  SmtpUser := Trim(PageSmtp.Values[2]);
  SmtpPass := Trim(PageSmtp.Values[3]);
  SmtpFrom := Trim(PageSmtp.Values[4]);
  SmtpName := Trim(PageSmtp.Values[5]);
  if SmtpPort = '' then SmtpPort := '587';
  if SmtpName = '' then SmtpName := 'BioVisitor — Suprema LATAM';
  if SmtpFrom = '' then SmtpFrom := SmtpUser;

  EnvContent :=
    '# ============================================================' + #13#10 +
    '#  BioVisitor X — Backend Configuration' + #13#10 +
    '#  Generado automaticamente por el installer' + #13#10 +
    '# ============================================================' + #13#10 +
    'NODE_ENV=production' + #13#10 +
    'APP_PORT=' + IntToStr(PortAPI) + #13#10 +
    '' + #13#10 +
    '# PostgreSQL' + #13#10 +
    'DB_HOST=localhost' + #13#10 +
    'DB_PORT=' + IntToStr(PortDB) + #13#10 +
    'DB_USERNAME=postgres' + #13#10 +
    'DB_PASSWORD=' + SuperPass + #13#10 +
    'DB_NAME=biovisitor_db' + #13#10 +
    '' + #13#10 +
    '# Redis' + #13#10 +
    'REDIS_HOST=127.0.0.1' + #13#10 +
    'REDIS_PORT=6379' + #13#10 +
    '' + #13#10 +
    '# Seguridad (auto-generados)' + #13#10 +
    'JWT_SECRET=' + JwtSecret + #13#10 +
    'JWT_EXPIRES_IN=8h' + #13#10 +
    'JWT_REFRESH_EXPIRES_IN=7d' + #13#10 +
    'ENCRYPTION_MASTER_KEY=' + LowerCase(EncKey) + #13#10 +
    'QR_JWT_SECRET=' + QrSecret + #13#10 +
    'QR_EXPIRATION_MINUTES=5' + #13#10 +
    '' + #13#10 +
    '# URLs' + #13#10 +
    'FRONTEND_URL=https://' + SelectedIP + IfThen(PortHTTPS <> 443, ':' + IntToStr(PortHTTPS), '') + #13#10 +
    'CORS_ALLOWED_ORIGINS=https://' + SelectedIP + IfThen(PortHTTPS <> 443, ':' + IntToStr(PortHTTPS), '') + #13#10 +
    '' + #13#10 +
    '# SMTP (notificaciones de email)' + #13#10;

  if SmtpHost <> '' then
    EnvContent := EnvContent +
      'SMTP_HOST=' + SmtpHost + #13#10 +
      'SMTP_PORT=' + SmtpPort + #13#10 +
      'SMTP_SECURE=' + IfThen(SmtpPort = '465', 'true', 'false') + #13#10 +
      'SMTP_USER=' + SmtpUser + #13#10 +
      'SMTP_PASSWORD=' + SmtpPass + #13#10 +
      'SMTP_FROM_NAME=' + SmtpName + #13#10 +
      'SMTP_FROM=' + SmtpFrom + #13#10
  else
    EnvContent := EnvContent +
      '# SMTP no configurado. Completar manualmente si se necesitan emails.' + #13#10 +
      '# SMTP_HOST=smtp.gmail.com' + #13#10 +
      '# SMTP_PORT=587' + #13#10 +
      '# SMTP_USER=tu@email.com' + #13#10 +
      '# SMTP_PASSWORD=tu_app_password' + #13#10;

  EnvContent := EnvContent +
    '' + #13#10 +
    '# Almacenamiento' + #13#10 +
    'UPLOAD_DIR=uploads' + #13#10 +
    'MAX_FILE_SIZE_MB=10' + #13#10 +
    '' + #13#10 +
    '# Logging' + #13#10 +
    'LOG_LEVEL=warn' + #13#10;

  SaveStringToFile(EnvPath, EnvContent, False);
  ForceDirectories(InstallDir + '\backend\uploads\photos');
end;


// ─── Actualización del .env del backend (modo upgrade) ─────────────────────
// A diferencia de WriteBackendEnv (que regenera todo el archivo con
// secretos nuevos), esta procedimiento conserva TODO el .env existente tal
// cual — incluyendo DB_PASSWORD, JWT_SECRET, ENCRYPTION_MASTER_KEY y
// QR_JWT_SECRET — y solo reemplaza las claves que el wizard permite tocar
// en una actualización (puerto API, URLs derivadas de la IP, y SMTP solo
// si el usuario escribió algo nuevo). Regenerar esos secretos en cada
// actualización invalidaría todas las sesiones activas y, en el caso de
// ENCRYPTION_MASTER_KEY, dejaría indescifrables las credenciales de
// BioStar ya guardadas en la base de datos existente.
procedure PatchBackendEnvForUpgrade(InstallDir, SelectedIP: String);
var
  EnvPath:  String;
  Lines:    TArrayOfString;
  OutLines: TStringList;
  I:        Integer;
  Line:     String;
  Handled:  Boolean;
  SmtpHost, SmtpPort, SmtpUser, SmtpPass, SmtpFrom, SmtpName: String;
begin
  EnvPath := InstallDir + '\backend\.env';
  if not LoadStringsFromFile(EnvPath, Lines) then
  begin
    // No debería ocurrir en modo upgrade (ya se confirmó antes que el
    // .env existe), pero si pasa, no dejamos el backend sin configurar:
    // regeneramos desde cero reutilizando la contraseña de PostgreSQL ya
    // conocida en vez de fallar silenciosamente.
    WriteBackendEnv(InstallDir, PriorDbPassword, SelectedIP);
    Exit;
  end;

  SmtpHost := Trim(PageSmtp.Values[0]);
  SmtpPort := Trim(PageSmtp.Values[1]);
  SmtpUser := Trim(PageSmtp.Values[2]);
  SmtpPass := Trim(PageSmtp.Values[3]);
  SmtpFrom := Trim(PageSmtp.Values[4]);
  SmtpName := Trim(PageSmtp.Values[5]);
  if SmtpPort = '' then SmtpPort := '587';
  if SmtpFrom = '' then SmtpFrom := SmtpUser;

  OutLines := TStringList.Create;
  try
    for I := 0 to GetArrayLength(Lines) - 1 do
    begin
      Line    := Lines[I];
      Handled := False;

      if Copy(Line, 1, 9) = 'APP_PORT=' then
      begin OutLines.Add('APP_PORT=' + IntToStr(PortAPI)); Handled := True; end
      else if Copy(Line, 1, 8) = 'DB_PORT=' then
      // PortDB ya quedó forzado al valor existente en modo actualización
      // (ver NextButtonClick) — esto es un no-op salvo que en el futuro
      // el BioVisitor Admin Tool haya movido el puerto real de Postgres.
      begin OutLines.Add('DB_PORT=' + IntToStr(PortDB)); Handled := True; end
      else if Copy(Line, 1, 13) = 'FRONTEND_URL=' then
      begin
        OutLines.Add('FRONTEND_URL=https://' + SelectedIP +
          IfThen(PortHTTPS <> 443, ':' + IntToStr(PortHTTPS), ''));
        Handled := True;
      end
      else if Copy(Line, 1, 21) = 'CORS_ALLOWED_ORIGINS=' then
      begin
        OutLines.Add('CORS_ALLOWED_ORIGINS=https://' + SelectedIP +
          IfThen(PortHTTPS <> 443, ':' + IntToStr(PortHTTPS), ''));
        Handled := True;
      end
      // Los campos SMTP solo se tocan si el admin escribió algo nuevo en
      // el wizard — dejar en blanco esa página en una actualización debe
      // conservar el SMTP ya configurado, no borrarlo.
      else if (SmtpHost <> '') and (Copy(Line, 1, 10) = 'SMTP_HOST=') then
      begin OutLines.Add('SMTP_HOST=' + SmtpHost); Handled := True; end
      else if (SmtpHost <> '') and (Copy(Line, 1, 10) = 'SMTP_PORT=') then
      begin OutLines.Add('SMTP_PORT=' + SmtpPort); Handled := True; end
      else if (SmtpHost <> '') and (Copy(Line, 1, 12) = 'SMTP_SECURE=') then
      begin OutLines.Add('SMTP_SECURE=' + IfThen(SmtpPort = '465', 'true', 'false')); Handled := True; end
      else if (SmtpHost <> '') and (Copy(Line, 1, 10) = 'SMTP_USER=') then
      begin OutLines.Add('SMTP_USER=' + SmtpUser); Handled := True; end
      else if (SmtpHost <> '') and (Copy(Line, 1, 14) = 'SMTP_PASSWORD=') then
      begin OutLines.Add('SMTP_PASSWORD=' + SmtpPass); Handled := True; end
      else if (SmtpHost <> '') and (Copy(Line, 1, 10) = 'SMTP_FROM=') then
      begin OutLines.Add('SMTP_FROM=' + SmtpFrom); Handled := True; end
      else if (SmtpHost <> '') and (Copy(Line, 1, 15) = 'SMTP_FROM_NAME=') then
      begin OutLines.Add('SMTP_FROM_NAME=' + SmtpName); Handled := True; end;

      if not Handled then OutLines.Add(Line);
    end;

    OutLines.SaveToFile(EnvPath);
  finally
    OutLines.Free;
  end;
end;


// ─── Instalación de servicios NSSM ────────────────────────────────────────

procedure InstallNSSMServices(InstallDir, SelectedIP: String);
var
  NssmExe: String;
  NodeExe: String;
  LogBase: String;
  RC:      Integer;
begin
  NssmExe := InstallDir + '\tools\nssm.exe';
  LogBase  := InstallDir + '\logs';
  ForceDirectories(LogBase + '\backend');
  ForceDirectories(LogBase + '\frontend');
  NodeExe := GetNodeExePath;

  // ── Backend ────────────────────────────────────────────────────────────
  WizardForm.StatusLabel.Caption := 'Instalando servicio backend...';
  Exec(NssmExe, 'stop "'   + '{#SvcBackend}' + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'remove "' + '{#SvcBackend}' + '" confirm', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'install "' + '{#SvcBackend}' + '" "' + InstallDir + '\backend\biovisitor-backend.exe"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppDirectory "'        + InstallDir + '\backend"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" DisplayName "Suprema LATAM BioVisitor Service"',   '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" Description "API Backend BioVisitor X — Suprema LATAM"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" Start SERVICE_AUTO_START', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppStdout "' + LogBase + '\backend\backend.log"',       '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppStderr "' + LogBase + '\backend\backend-error.log"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppRotateFiles 1',         '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppRotateOnline 1',        '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppRotateBytes 10485760',  '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppRestartDelay 3000',     '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcBackend}' + '" AppThrottle 5000',         '', SW_HIDE, ewWaitUntilTerminated, RC);

  // ── Frontend ───────────────────────────────────────────────────────────
  WizardForm.StatusLabel.Caption := 'Instalando servicio frontend...';
  Exec(NssmExe, 'stop "'   + '{#SvcFrontend}' + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'remove "' + '{#SvcFrontend}' + '" confirm', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'install "' + '{#SvcFrontend}' + '" "' + NodeExe + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppParameters "server-https.js"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppDirectory "' + InstallDir + '\frontend"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" DisplayName "Suprema LATAM BioVisitor Web GUI"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" Description "Interfaz Web HTTPS — Suprema LATAM BioVisitor X"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" Start SERVICE_AUTO_START', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe,
    'set "' + '{#SvcFrontend}' + '" AppEnvironmentExtra' +
    ' "NODE_ENV=production" "NEXT_PUBLIC_API_URL=/api/v1"' +
    ' "PORT=' + IntToStr(PortHTTPS) + '"' +
    ' "HTTP_PORT=' + IntToStr(PortHTTP) + '"' +
    ' "NEXT_INTERNAL_PORT=3000"',
    '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppStdout "' + LogBase + '\frontend\frontend.log"',       '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppStderr "' + LogBase + '\frontend\frontend-error.log"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppRotateFiles 1',         '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppRotateBytes 10485760',  '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppRestartDelay 5000',     '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" AppThrottle 10000',        '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(NssmExe, 'set "' + '{#SvcFrontend}' + '" DependOnService "' + '{#SvcBackend}' + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
end;


// ─── Firewall ──────────────────────────────────────────────────────────────

procedure ConfigureFirewall;
var RC: Integer;
begin
  Exec('netsh.exe', 'advfirewall firewall delete rule name="BioVisitor HTTPS"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec('netsh.exe', 'advfirewall firewall delete rule name="BioVisitor HTTP"',  '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec('netsh.exe',
    'advfirewall firewall add rule name="BioVisitor HTTPS" dir=in action=allow protocol=TCP localport=' + IntToStr(PortHTTPS),
    '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec('netsh.exe',
    'advfirewall firewall add rule name="BioVisitor HTTP" dir=in action=allow protocol=TCP localport=' + IntToStr(PortHTTP),
    '', SW_HIDE, ewWaitUntilTerminated, RC);
end;


// ─── URL shortcut ──────────────────────────────────────────────────────────

procedure CreateUrlShortcut(InstallDir, SelectedIP: String);
begin
  SaveStringToFile(InstallDir + '\BioVisitor.url',
    '[InternetShortcut]' + #13#10 +
    'URL=https://' + SelectedIP + IfThen(PortHTTPS <> 443, ':' + IntToStr(PortHTTPS), '') + #13#10 +
    'IconIndex=0' + #13#10,
    False);
end;


// ─── Inicialización del wizard ─────────────────────────────────────────────

procedure InitializeWizard;
begin
  NicIPList := TStringList.Create;

  // ── Página: Credenciales PostgreSQL ──────────────────────────────────
  // BioVisitor X se conecta a PostgreSQL con el propio superusuario
  // "postgres" (sin crear un rol de aplicación aparte), así que esta
  // contraseña es tanto la del servidor PostgreSQL como la que usará
  // el backend para conectarse.
  PageDbCreds := CreateInputQueryPage(wpSelectDir,
    'Configuración de Base de Datos',
    'Contraseña del superusuario "postgres" de PostgreSQL.',
    'El backend de BioVisitor X se conectará con esta misma cuenta — no se crea ningún otro usuario de base de datos.');
  PageDbCreds.Add('Contraseña del superusuario de PostgreSQL (postgres):', True);
  PageDbCreds.Add('Confirmar contraseña:', True);

  // ── Página: Selección de interfaz de red ─────────────────────────────
  PageNicSelect := CreateCustomPage(PageDbCreds.ID,
    'Interfaz de Red para el Certificado SSL',
    'Selecciona la IP que los clientes usarán para conectarse a BioVisitor X.');

  NicLabel := TNewStaticText.Create(PageNicSelect);
  NicLabel.Parent  := PageNicSelect.Surface;
  NicLabel.Left    := 0;
  NicLabel.Top     := 0;
  NicLabel.Width   := PageNicSelect.SurfaceWidth;
  NicLabel.Caption := 'Interfaces de red disponibles (IPv4):';

  NicListBox := TNewListBox.Create(PageNicSelect);
  NicListBox.Parent := PageNicSelect.Surface;
  NicListBox.Left   := 0;
  NicListBox.Top    := 20;
  NicListBox.Width  := PageNicSelect.SurfaceWidth;
  NicListBox.Height := 150;

  NicHint := TNewStaticText.Create(PageNicSelect);
  NicHint.Parent  := PageNicSelect.Surface;
  NicHint.Left    := 0;
  NicHint.Top     := 180;
  NicHint.Width   := PageNicSelect.SurfaceWidth;
  NicHint.Caption :=
    'Esta IP se incluirá en el certificado SSL y en las URLs.' + #13#10 +
    'Selecciona la IP de la red LAN donde los visitantes accederán.' + #13#10 +
    'El certificado también cubre 127.0.0.1 y localhost.';

  // ── Página: Configuración de puertos ─────────────────────────────────
  PagePorts := CreateInputQueryPage(PageNicSelect.ID,
    'Configuración de Puertos',
    'Los puertos marcados con [!] están ocupados — ya se sugirió un alternativo.',
    'Puedes modificar cualquier puerto antes de continuar.');
  PagePorts.Add('Puerto HTTPS  (acceso principal, navegadores):', False);
  PagePorts.Add('Puerto HTTP   (redirige automáticamente a HTTPS):', False);
  PagePorts.Add('Puerto API    (backend interno — no exponer):', False);
  PagePorts.Add('Puerto de PostgreSQL dedicado (BioVisitor Database Service):', False);
  PagePorts.Values[0] := '443';
  PagePorts.Values[1] := '80';
  PagePorts.Values[2] := '3001';
  PagePorts.Values[3] := '{#DefaultDbPort}';

  // ── Página: Configuración SMTP ────────────────────────────────────────
  PageSmtp := CreateInputQueryPage(PagePorts.ID,
    'Configuración de Email (opcional)',
    'BioVisitor X envía notificaciones y encuestas de salida por email.' + #13#10 +
    'Si no lo configuras ahora, puedes editarlo después en ' +
    WizardDirValue + '\backend\.env',
    'Deja en blanco si no deseas configurar email en este momento.');
  PageSmtp.Add('Servidor SMTP (ej: smtp.gmail.com):', False);
  PageSmtp.Add('Puerto SMTP (587 = TLS, 465 = SSL, 25 = sin cifrado):', False);
  PageSmtp.Add('Usuario SMTP (email de la cuenta remitente):', False);
  PageSmtp.Add('Contraseña / App Password SMTP:', True);
  PageSmtp.Add('Email remitente (FROM) — puede ser igual al usuario:', False);
  PageSmtp.Add('Nombre del remitente:', False);
  PageSmtp.Values[1] := '587';
  PageSmtp.Values[5] := 'BioVisitor — Suprema LATAM';
end;


// ─── Omitir páginas en modo actualización ─────────────────────────────────

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // En una actualización ya conocemos la contraseña de PostgreSQL (se leyó
  // del backend\.env existente en InitializeSetup) — no volver a pedirla.
  Result := IsUpgradeMode and (PageID = PageDbCreds.ID);
end;


// ─── Poblar la lista de NICs al entrar a esa página ───────────────────────
// Antes se poblaba al salir de PageDbCreds (NextButtonClick), pero esa
// página se omite en modo actualización (ShouldSkipPage) — poblarla al
// ENTRAR a PageNicSelect funciona en ambos flujos y también se refresca
// correctamente si el usuario navega hacia atrás y adelante otra vez.
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = PageNicSelect.ID then
    PopulateNicList;
end;


// ─── Validaciones entre páginas ────────────────────────────────────────────

function NextButtonClick(CurPageID: Integer): Boolean;
var
  PgSup, PgSup2: String;
  PgPort:        Integer;
begin
  Result := True;

  // ── Validar credenciales DB ───────────────────────────────────────────
  if CurPageID = PageDbCreds.ID then
  begin
    PgSup  := PageDbCreds.Values[0];
    PgSup2 := PageDbCreds.Values[1];

    if PgSup = '' then begin
      MsgBox('La contraseña del superusuario de PostgreSQL es obligatoria.', mbError, MB_OK);
      Result := False; Exit;
    end;
    if PgSup <> PgSup2 then begin
      MsgBox('Las contraseñas no coinciden. Verifícalas.', mbError, MB_OK);
      Result := False; Exit;
    end;
    if Length(PgSup) < 8 then begin
      MsgBox('La contraseña debe tener al menos 8 caracteres.', mbError, MB_OK);
      Result := False; Exit;
    end;
  end;

  // ── Validar selección NIC ─────────────────────────────────────────────
  if CurPageID = PageNicSelect.ID then
  begin
    if NicListBox.ItemIndex < 0 then begin
      MsgBox('Selecciona una interfaz de red.', mbError, MB_OK);
      Result := False; Exit;
    end;
    // Verificar conflictos de puertos
    WizardForm.StatusLabel.Caption := 'Verificando puertos en uso...';
    CheckPortConflicts;
    if HasPortConflict then
      MsgBox(
        'Se detectaron puertos ocupados.' + #13#10 +
        'Se sugirieron alternativas en la siguiente página.' + #13#10 +
        'Puedes editarlos o aceptar los valores sugeridos.',
        mbInformation, MB_OK);
  end;

  // ── Validar puertos ───────────────────────────────────────────────────
  if CurPageID = PagePorts.ID then
  begin
    PortHTTPS := StrToIntDef(PagePorts.Values[0], 0);
    PortHTTP  := StrToIntDef(PagePorts.Values[1], 0);
    PortAPI   := StrToIntDef(PagePorts.Values[2], 0);
    PortDB    := StrToIntDef(PagePorts.Values[3], 0);

    // En modo actualización el puerto de PostgreSQL no es editable desde
    // este wizard (ver comentario en CheckPortConflicts) — se ignora
    // cualquier valor que el usuario haya escrito en ese campo.
    if IsUpgradeMode then
      PortDB := StrToIntDef(PriorDbPort, PortDB);

    if (PortHTTPS < 1) or (PortHTTPS > 65535) then begin
      MsgBox('Puerto HTTPS inválido (rango: 1–65535).', mbError, MB_OK); Result := False; Exit;
    end;
    if (PortHTTP < 1) or (PortHTTP > 65535) then begin
      MsgBox('Puerto HTTP inválido (rango: 1–65535).', mbError, MB_OK); Result := False; Exit;
    end;
    if (PortAPI < 1) or (PortAPI > 65535) then begin
      MsgBox('Puerto API inválido (rango: 1–65535).', mbError, MB_OK); Result := False; Exit;
    end;
    if (PortDB < 1) or (PortDB > 65535) then begin
      MsgBox('Puerto de PostgreSQL inválido (rango: 1–65535).', mbError, MB_OK); Result := False; Exit;
    end;
    if PortHTTPS = PortHTTP then begin
      MsgBox('El puerto HTTPS y el HTTP no pueden ser iguales.', mbError, MB_OK); Result := False; Exit;
    end;
    if PortHTTPS = PortAPI then begin
      MsgBox('El puerto HTTPS y el API no pueden ser iguales.', mbError, MB_OK); Result := False; Exit;
    end;
    if (PortDB = PortHTTPS) or (PortDB = PortHTTP) or (PortDB = PortAPI) then begin
      MsgBox('El puerto de PostgreSQL debe ser distinto de los demás puertos.', mbError, MB_OK); Result := False; Exit;
    end;
  end;

  // ── Validación SMTP (solo si el usuario puso algo) ────────────────────
  if CurPageID = PageSmtp.ID then
  begin
    if (PageSmtp.Values[0] <> '') and (PageSmtp.Values[2] = '') then begin
      MsgBox('Si configuras SMTP, el campo "Usuario SMTP" es obligatorio.', mbError, MB_OK);
      Result := False; Exit;
    end;
    PgPort := StrToIntDef(PageSmtp.Values[1], 587);
    if (PgPort < 1) or (PgPort > 65535) then begin
      MsgBox('Puerto SMTP inválido (rango: 1–65535).', mbError, MB_OK); Result := False; Exit;
    end;
  end;
end;


// ─── Ejecución principal de la instalación ────────────────────────────────

procedure LogInstallStep(InstallDir, Msg: String);
begin
  SaveStringToFile(InstallDir + '\install-log.txt',
    GetDateTimeString('yyyy-mm-dd hh:nn:ss', #0, #0) + '  ' + Msg + #13#10,
    True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  InstallDir: String;
  SuperPass:  String;
  SelectedIP: String;
  RC:         Integer;
begin
  if CurStep <> ssPostInstall then Exit;

  InstallDir := WizardDirValue;
  SuperPass  := PageDbCreds.Values[0];
  SelectedIP := GetSelectedIP;

  // Cada paso queda aislado con try/except: si uno falla (por ejemplo,
  // la generación del certificado SSL o el registro de un servicio NSSM),
  // el resto de la instalación —sobre todo el .env del backend, que el
  // usuario necesita sí o sí— continúa en lugar de quedar a medias.

  // 1 – Node.js
  try
    WizardForm.StatusLabel.Caption := 'Verificando Node.js...';
    InstallNodeJS;
    LogInstallStep(InstallDir, 'Node.js: OK');
  except
    LogInstallStep(InstallDir, 'Node.js: ERROR - ' + GetExceptionMessage);
  end;

  // 2 – Redis (se omite en modo actualización: ya está instalado)
  if not IsUpgradeMode then
  try
    WizardForm.StatusLabel.Caption := 'Instalando Redis...';
    InstallRedis;
    LogInstallStep(InstallDir, 'Redis: OK');
  except
    LogInstallStep(InstallDir, 'Redis: ERROR - ' + GetExceptionMessage);
  end
  else
    LogInstallStep(InstallDir, 'Redis: omitido (modo actualización)');

  // 3 – PostgreSQL (se omite en modo actualización: ya está instalado, y
  //     SuperPass está vacío porque no se mostró la página de credenciales)
  if not IsUpgradeMode then
  try
    WizardForm.StatusLabel.Caption := 'Instalando PostgreSQL 16...';
    InstallPostgreSQL(SuperPass);
    LogInstallStep(InstallDir, 'PostgreSQL: OK');
  except
    LogInstallStep(InstallDir, 'PostgreSQL: ERROR - ' + GetExceptionMessage);
  end
  else
    LogInstallStep(InstallDir, 'PostgreSQL: omitido (modo actualización)');

  // 4 – Base de datos: schema + seed (se omite en modo actualización — ya
  //     existen las tablas y los datos; volver a correr schema.sql fallaría
  //     o, peor, podría machacar datos existentes)
  if not IsUpgradeMode then
  try
    WizardForm.StatusLabel.Caption := 'Configurando base de datos...';
    CreateDatabase(SuperPass);
    LogInstallStep(InstallDir, 'Base de datos: OK');
  except
    LogInstallStep(InstallDir, 'Base de datos: ERROR - ' + GetExceptionMessage);
  end
  else
    LogInstallStep(InstallDir, 'Base de datos: omitida (modo actualización, se conserva la existente)');

  // 5 – Archivo .env del backend (se escribe temprano a propósito: es lo
  //     más importante y no debe depender de que los pasos siguientes,
  //     más frágiles por depender de herramientas externas, funcionen).
  //     En modo actualización se PARCHEA el .env existente en vez de
  //     regenerarlo — ver comentario en PatchBackendEnvForUpgrade sobre
  //     por qué regenerar los secretos en cada actualización sería dañino.
  try
    WizardForm.StatusLabel.Caption := 'Generando configuración del backend...';
    if IsUpgradeMode then
      PatchBackendEnvForUpgrade(InstallDir, SelectedIP)
    else
      WriteBackendEnv(InstallDir, SuperPass, SelectedIP);
    LogInstallStep(InstallDir, '.env del backend: OK (' + InstallDir + '\backend\.env)');
  except
    LogInstallStep(InstallDir, '.env del backend: ERROR - ' + GetExceptionMessage);
  end;

  // 6 – Certificado SSL
  try
    WizardForm.StatusLabel.Caption := 'Generando certificado SSL (Suprema LATAM, 7 años)...';
    GenerateSSLCert(InstallDir, SelectedIP, DetectedCountry);
    LogInstallStep(InstallDir, 'Certificado SSL: OK');
  except
    LogInstallStep(InstallDir, 'Certificado SSL: ERROR - ' + GetExceptionMessage);
  end;

  // 7 – Servicios NSSM
  try
    WizardForm.StatusLabel.Caption := 'Instalando servicios de Windows...';
    InstallNSSMServices(InstallDir, SelectedIP);
    LogInstallStep(InstallDir, 'Servicios NSSM: OK');
  except
    LogInstallStep(InstallDir, 'Servicios NSSM: ERROR - ' + GetExceptionMessage);
  end;

  // 8 – Firewall
  try
    WizardForm.StatusLabel.Caption := 'Configurando firewall de Windows...';
    ConfigureFirewall;
  except
    LogInstallStep(InstallDir, 'Firewall: ERROR - ' + GetExceptionMessage);
  end;

  // 9 – Acceso directo URL
  try
    CreateUrlShortcut(InstallDir, SelectedIP);
  except
    LogInstallStep(InstallDir, 'Acceso directo: ERROR - ' + GetExceptionMessage);
  end;

  // 10 – Iniciar servicios
  WizardForm.StatusLabel.Caption := 'Iniciando servicios...';
  Exec(InstallDir + '\tools\nssm.exe',
    'start "' + '{#SvcBackend}' + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec('powershell.exe', '-NoProfile -Command "Start-Sleep 5"', '', SW_HIDE, ewWaitUntilTerminated, RC);
  Exec(InstallDir + '\tools\nssm.exe',
    'start "' + '{#SvcFrontend}' + '"', '', SW_HIDE, ewWaitUntilTerminated, RC);

  WizardForm.StatusLabel.Caption := 'Instalación completada.';
end;


// ─── Desinstalación con opción de eliminar la BD ──────────────────────────

// Lee el valor de una clave KEY=valor de un archivo .env. Se usa para
// recuperar la contraseña de postgres del backend\.env ya instalado,
// en vez de volver a pedirla: InputQuery (el diálogo de texto del wizard)
// no está disponible en el contexto del desinstalador de Inno Setup.
function ReadEnvValue(FilePath, Key: String): String;
var
  Lines: TArrayOfString;
  I:     Integer;
  Line:  String;
begin
  Result := '';
  if not LoadStringsFromFile(FilePath, Lines) then Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    Line := Lines[I];
    if Copy(Line, 1, Length(Key) + 1) = (Key + '=') then
    begin
      Result := Copy(Line, Length(Key) + 2, Length(Line) - Length(Key) - 1);
      Exit;
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Answer:  Integer;
  PgBin:   String;
  PsqlExe: String;
  SuperPw: String;
  DbPort:  String;
  TmpSql:  String;
  RC:      Integer;
begin
  // Justo ANTES de desinstalar los archivos — preguntar por la BD
  if CurUninstallStep = usUninstall then
  begin
    Answer := MsgBox(
      '¿Desea eliminar la base de datos de BioVisitor X?' + #13#10 + #13#10 +
      '  Nombre de la BD: biovisitor_db' + #13#10 + #13#10 +
      'Si elige SÍ, se perderán TODOS los registros de visitantes,' + #13#10 +
      'visitas, auditoría y configuración.' + #13#10 + #13#10 +
      'Si elige NO, la base de datos quedará intacta en PostgreSQL' + #13#10 +
      'y podrá hacer un respaldo antes de eliminarla manualmente.' + #13#10 + #13#10 +
      '¿Eliminar la base de datos?',
      mbConfirmation,
      MB_YESNO or MB_DEFBUTTON2);   // "No" como opción por defecto

    if Answer = IDYES then
    begin
      // La contraseña de postgres ya quedó guardada en backend\.env durante
      // la instalación (BioVisitor se conecta con ese mismo superusuario),
      // así que la reutilizamos en vez de volver a pedirla.
      SuperPw := ReadEnvValue(ExpandConstant('{app}') + '\backend\.env', 'DB_PASSWORD');
      if SuperPw = '' then
      begin
        MsgBox('No se pudo leer la contraseña de PostgreSQL desde backend\.env.' + #13#10 +
               'Elimina la base de datos manualmente con pgAdmin o psql.', mbError, MB_OK);
        Exit;
      end;

      DbPort := ReadEnvValue(ExpandConstant('{app}') + '\backend\.env', 'DB_PORT');
      if DbPort = '' then DbPort := '{#DefaultDbPort}';

      PgBin := FindPgBin;
      if PgBin = '' then
      begin
        MsgBox('No se encontró psql.exe. Elimina la BD manualmente con pgAdmin.',
               mbError, MB_OK);
        Exit;
      end;

      PsqlExe := PgBin + '\psql.exe';
      TmpSql  := ExpandConstant('{tmp}') + '\bvx_drop.sql';
      SetEnvironmentVariable('PGPASSWORD', SuperPw);

      // Terminar conexiones activas y eliminar la BD
      // (no se elimina ningún rol: BioVisitor usa el superusuario "postgres")
      SaveStringToFile(TmpSql,
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=''biovisitor_db'';' + #13#10 +
        'DROP DATABASE IF EXISTS biovisitor_db;',
        False);

      Exec(PsqlExe,
        '-U postgres -h 127.0.0.1 -p ' + DbPort + ' -f "' + TmpSql + '"',
        '', SW_HIDE, ewWaitUntilTerminated, RC);

      SetEnvironmentVariable('PGPASSWORD', '');

      if RC = 0 then
        MsgBox('La base de datos biovisitor_db fue eliminada correctamente.', mbInformation, MB_OK)
      else
        MsgBox('No se pudo eliminar la base de datos automáticamente.' + #13#10 +
               'Elimínala manualmente con pgAdmin o psql.', mbError, MB_OK);
    end;
  end;
end;


// ─── Inicialización global ─────────────────────────────────────────────────

function InitializeSetup: Boolean;
var
  UninstallKey: String;
  Answer:       Integer;
begin
  Result := True;
  DetectedCountry := DetectCountry;

  IsUpgradeMode   := False;
  PriorInstallDir := '';
  PriorDbPassword := '';

  // ── Detección de instalación previa ───────────────────────────────────
  // Se usa la clave de desinstalación de Windows (indexada por AppId, fijo
  // entre versiones) en vez de solo comprobar la carpeta por defecto, para
  // detectar también instalaciones hechas en un directorio distinto.
  UninstallKey := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\' +
    '{#AppIdGuid}' + '_is1';

  if RegKeyExists(HKLM, UninstallKey) then
  begin
    RegQueryStringValue(HKLM, UninstallKey, 'Inno Setup: App Path', PriorInstallDir);

    if (PriorInstallDir <> '') and DirExists(PriorInstallDir) then
    begin
      Answer := MsgBox(
        'Se detectó una instalación existente de BioVisitor X en:' + #13#10 +
        '  ' + PriorInstallDir + #13#10 + #13#10 +
        '¿Desea continuar y ACTUALIZARLA?' + #13#10 +
        '(Se conservará la base de datos, las credenciales y la clave de' + #13#10 +
        ' cifrado existentes — no se le volverá a pedir la contraseña de' + #13#10 +
        ' PostgreSQL.)' + #13#10 + #13#10 +
        'Elija "No" para cancelar este instalador y ejecutar primero' + #13#10 +
        'el desinstalador si prefiere una instalación limpia.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON1);

      if Answer = IDNO then
      begin
        Result := False;
        Exit;
      end;

      IsUpgradeMode := True;

      if not FileExists(PriorInstallDir + '\backend\.env') then
      begin
        MsgBox(
          'No se encontró backend\.env en la instalación existente.' + #13#10 +
          'Se continuará como actualización, pero no fue posible leer la' + #13#10 +
          'contraseña de PostgreSQL — si falla la configuración de la base' + #13#10 +
          'de datos, complétela manualmente después de instalar.',
          mbInformation, MB_OK);
      end
      else
      begin
        PriorDbPassword := ReadEnvValue(PriorInstallDir + '\backend\.env', 'DB_PASSWORD');
        PriorDbPort     := ReadEnvValue(PriorInstallDir + '\backend\.env', 'DB_PORT');
        if PriorDbPort = '' then PriorDbPort := '{#DefaultDbPort}';
      end;
    end;
  end;
end;

procedure DeinitializeSetup;
begin
  NicIPList.Free;
end;


// ─── Resumen en la página Ready ────────────────────────────────────────────

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  SmtpHost: String;
  IP:       String;
begin
  IP       := GetSelectedIP;
  SmtpHost := Trim(PageSmtp.Values[0]);

  Result :=
    'Resumen de instalación:' + NewLine + NewLine +
    Space + 'Modo            : ' + IfThen(IsUpgradeMode,
      'Actualización (instalación existente detectada)', 'Instalación nueva') + NewLine +
    Space + 'Directorio      : ' + WizardDirValue + NewLine +
    Space + 'IP del servidor : ' + IP + NewLine +
    Space + 'País SSL        : ' + DetectedCountry + NewLine +
    Space + 'Puerto HTTPS    : ' + IntToStr(PortHTTPS) + NewLine +
    Space + 'Puerto HTTP     : ' + IntToStr(PortHTTP) + NewLine +
    Space + 'Puerto API      : ' + IntToStr(PortAPI) + NewLine +
    Space + 'Puerto PostgreSQL: ' + IntToStr(PortDB) + NewLine +
    NewLine +
    Space + 'Servicio backend    : {#SvcBackend}' + NewLine +
    Space + 'Servicio frontend   : {#SvcFrontend}' + NewLine +
    Space + 'Servicio PostgreSQL : {#PgServiceName}' + NewLine +
    NewLine;

  if SmtpHost <> '' then
    Result := Result +
      Space + 'SMTP             : ' + SmtpHost + ':' + PageSmtp.Values[1] + NewLine +
      Space + 'SMTP usuario     : ' + PageSmtp.Values[2] + NewLine + NewLine
  else
    Result := Result +
      Space + 'SMTP             : No configurado (editable en .env)' + NewLine + NewLine;

  Result := Result +
    Space + 'URL de acceso    : https://' + IP +
      IfThen(PortHTTPS <> 443, ':' + IntToStr(PortHTTPS), '') + NewLine +
    Space + 'Primer inicio    : sin administrador — se configura al abrir la URL' + NewLine +
    NewLine +
    MemoDirInfo;
end;
