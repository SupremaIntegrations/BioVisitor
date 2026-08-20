# ================================================================
#  BioVisitor X — Script de descarga de redistribuibles
#  Suprema LATAM
#
#  Uso: Click derecho → "Ejecutar con PowerShell"
#       O desde CMD: powershell -ExecutionPolicy Bypass -File download-all.ps1
#
#  Descarga automáticamente:
#    - PostgreSQL 16.2
#    - Redis for Windows 5.0.14.1
#    - Node.js 24 LTS
#    - NSSM (Non-Sucking Service Manager)
#    - Inno Setup 6 (compilador del installer)
# ================================================================

$ErrorActionPreference = "Stop"

# ── Directorios de destino ────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $ScriptDir
$RedistDir = Join-Path $RootDir "redist"
$ToolsDir  = Join-Path $RootDir "tools"

foreach ($d in @($RedistDir, $ToolsDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}

# ── Función de descarga con barra de progreso ─────────────────
function Download-File {
    param(
        [string]$Url,
        [string]$Dest,
        [string]$Label
    )

    if (Test-Path $Dest) {
        Write-Host "  [OK] Ya existe: $(Split-Path -Leaf $Dest)" -ForegroundColor Green
        return
    }

    Write-Host ""
    Write-Host "  Descargando: $Label" -ForegroundColor Cyan
    Write-Host "  URL: $Url"
    Write-Host "  Destino: $Dest"

    $WebClient = New-Object System.Net.WebClient
    $WebClient.Headers.Add("User-Agent", "Mozilla/5.0 BioVisitorX-Installer")

    # Barra de progreso
    $Global:ProgressBytes = 0
    $Global:ProgressTotal = 0
    Register-ObjectEvent -InputObject $WebClient -EventName DownloadProgressChanged -Action {
        $Global:ProgressBytes = $Event.SourceEventArgs.BytesReceived
        $Global:ProgressTotal = $Event.SourceEventArgs.TotalBytesToReceive
        if ($Global:ProgressTotal -gt 0) {
            $pct = [int](($Global:ProgressBytes / $Global:ProgressTotal) * 100)
            Write-Progress -Activity "Descargando $Label" `
                -Status "$([math]::Round($Global:ProgressBytes / 1MB, 1)) MB de $([math]::Round($Global:ProgressTotal / 1MB, 1)) MB" `
                -PercentComplete $pct
        }
    } | Out-Null

    $done = $false
    $err  = $null
    Register-ObjectEvent -InputObject $WebClient -EventName DownloadFileCompleted -Action {
        $Global:DownloadDone = $true
        if ($Event.SourceEventArgs.Error) {
            $Global:DownloadError = $Event.SourceEventArgs.Error.Message
        }
    } | Out-Null

    $Global:DownloadDone  = $false
    $Global:DownloadError = $null

    $WebClient.DownloadFileAsync([Uri]$Url, $Dest)

    while (-not $Global:DownloadDone) { Start-Sleep -Milliseconds 200 }

    Write-Progress -Activity "Descargando $Label" -Completed

    if ($Global:DownloadError) {
        Write-Host "  [ERROR] $Global:DownloadError" -ForegroundColor Red
        if (Test-Path $Dest) { Remove-Item $Dest -Force }
        throw $Global:DownloadError
    }

    $sizeMB = [math]::Round((Get-Item $Dest).Length / 1MB, 1)
    Write-Host "  [OK] Descargado ($sizeMB MB)" -ForegroundColor Green
}

# ── Lista de descargas ────────────────────────────────────────
$Downloads = @(
    @{
        Label = "PostgreSQL 16.14 (instalador unattended)"
        Url   = "https://get.enterprisedb.com/postgresql/postgresql-16.14-2-windows-x64.exe"
        Dest  = Join-Path $RedistDir "postgresql-16.14-2-windows-x64.exe"
        Size  = "~330 MB"
    },
    @{
        Label = "Redis for Windows 5.0.14.1 (tporadowski)"
        Url   = "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.msi"
        Dest  = Join-Path $RedistDir "Redis-x64-5.0.14.1.msi"
        Size  = "~7 MB"
    },
    @{
        Label = "Node.js 24.19.0 LTS"
        Url   = "https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi"
        Dest  = Join-Path $RedistDir "node-v24.19.0-x64.msi"
        Size  = "~30 MB"
    }
)

# NSSM — ZIP que extraeremos
$NssmZipUrl  = "https://nssm.cc/release/nssm-2.24.zip"
$NssmZipDest = Join-Path $env:TEMP "nssm-2.24.zip"
$NssmExeDest = Join-Path $ToolsDir "nssm.exe"

# Inno Setup — instalador
$InnoUrl  = "https://files.jrsoftware.org/is/7/innosetup-7.0.0.exe"
$InnoDest = Join-Path $env:TEMP "innosetup-7.0.0.exe"

# ── Encabezado ────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  BioVisitor X — Descarga de redistribuibles             ║" -ForegroundColor Magenta
Write-Host "║  Suprema LATAM                                          ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
Write-Host "Carpeta redist : $RedistDir"
Write-Host "Carpeta tools  : $ToolsDir"
Write-Host ""
Write-Host "Archivos a descargar:"
foreach ($d in $Downloads) {
    $existe = if (Test-Path $d.Dest) { "[YA EXISTE]" } else { $d.Size }
    Write-Host "  • $($d.Label)  $existe"
}
Write-Host ""
$confirm = Read-Host "¿Iniciar descarga? (S/N)"
if ($confirm -notmatch '^[Ss]') { Write-Host "Cancelado."; exit 0 }

# ── Descargar redistribuibles ─────────────────────────────────
Write-Host ""
Write-Host "══ Redistribuibles ══════════════════════════════════════" -ForegroundColor Yellow
foreach ($d in $Downloads) {
    try {
        Download-File -Url $d.Url -Dest $d.Dest -Label $d.Label
    } catch {
        Write-Host ""
        Write-Host "  [FALLO] No se pudo descargar $($d.Label)" -ForegroundColor Red
        Write-Host "  Descárgalo manualmente desde:"
        Write-Host "  $($d.Url)" -ForegroundColor Gray
        Write-Host "  y colócalo en: $($d.Dest)"
    }
}

# ── NSSM ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "══ NSSM ════════════════════════════════════════════════" -ForegroundColor Yellow

if (Test-Path $NssmExeDest) {
    Write-Host "  [OK] nssm.exe ya existe en tools\" -ForegroundColor Green
} else {
    try {
        Download-File -Url $NssmZipUrl -Dest $NssmZipDest -Label "NSSM 2.24"

        Write-Host "  Extrayendo nssm.exe (win64)..."
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($NssmZipDest)
        $entry = $zip.Entries | Where-Object { $_.FullName -match "win64/nssm\.exe$" } | Select-Object -First 1
        if ($entry) {
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $NssmExeDest, $true)
            Write-Host "  [OK] nssm.exe copiado a tools\" -ForegroundColor Green
        } else {
            Write-Host "  [ERROR] No se encontró win64/nssm.exe dentro del ZIP." -ForegroundColor Red
        }
        $zip.Dispose()
    } catch {
        Write-Host "  [FALLO] $_" -ForegroundColor Red
        Write-Host "  Descarga manual: https://nssm.cc/download"
        Write-Host "  Extrae win64\nssm.exe → $NssmExeDest"
    }
}

# ── Inno Setup ────────────────────────────────────────────────
Write-Host ""
Write-Host "══ Inno Setup 7 ════════════════════════════════════════" -ForegroundColor Yellow

$IsccPath = "C:\Program Files (x86)\Inno Setup 7\iscc.exe"
if (Test-Path $IsccPath) {
    Write-Host "  [OK] Inno Setup 7 ya esta instalado." -ForegroundColor Green
} else {
    try {
        Download-File -Url $InnoUrl -Dest $InnoDest -Label "Inno Setup 7.0.0"

        Write-Host "  Instalando Inno Setup (requiere UAC)..."
        $proc = Start-Process -FilePath $InnoDest -ArgumentList "/VERYSILENT /NORESTART" -Wait -PassThru
        if ($proc.ExitCode -eq 0) {
            Write-Host "  [OK] Inno Setup instalado." -ForegroundColor Green
        } else {
            Write-Host "  [WARN] Código de salida: $($proc.ExitCode). Verifica la instalación." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [FALLO] $_" -ForegroundColor Red
        Write-Host "  Instala manualmente desde: https://jrsoftware.org/isdownload.php"
    }
}

# ── Verificación final ────────────────────────────────────────
Write-Host ""
Write-Host "══ Verificación ════════════════════════════════════════" -ForegroundColor Yellow

$allOk = $true
$checks = @(
    @{ Path = Join-Path $RedistDir "postgresql-16.14-2-windows-x64.exe"; Label = "PostgreSQL 16.14 installer" },
    @{ Path = Join-Path $RedistDir "Redis-x64-5.0.14.1.msi";            Label = "Redis MSI" },
    @{ Path = Join-Path $RedistDir "node-v24.19.0-x64.msi";             Label = "Node.js 24.19.0 MSI" },
    @{ Path = Join-Path $ToolsDir  "nssm.exe";                          Label = "NSSM" },
    @{ Path = $IsccPath;                                                 Label = "Inno Setup 7 (iscc.exe)" }
)

foreach ($c in $checks) {
    if (Test-Path $c.Path) {
        Write-Host "  [OK] $($c.Label)" -ForegroundColor Green
    } else {
        Write-Host "  [FALTA] $($c.Label)" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  Todo listo. Ejecuta:                                    ║" -ForegroundColor Green
    Write-Host "║  windows-deployment\setup\build-installer.bat            ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
} else {
    Write-Host "  Algunos archivos faltan. Descárgalos manualmente" -ForegroundColor Yellow
    Write-Host "  antes de ejecutar build-installer.bat"
}

Write-Host ""
pause
