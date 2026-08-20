# ============================================================
#  BioVisitor X — Generador de Certificado SSL
#  Solo requiere PowerShell 5.1 (incluido en Windows 10+)
#  Sin OpenSSL. Sin dependencias externas.
# ============================================================

param(
    [string]$ServerIP    = "",
    [string]$OrgName     = "",
    [string]$FrontendDir = "C:\BioVisitor\frontend"
)

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     BioVisitor X — Generador de Certificado SSL     ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ---- Solicitar datos si no se pasaron como parámetro ----
if (-not $ServerIP) {
    $ServerIP = Read-Host "IP o hostname del servidor (ej: 192.168.1.100)"
    if (-not $ServerIP) { $ServerIP = "localhost" }
}
if (-not $OrgName) {
    $OrgName = Read-Host "Nombre de la empresa (ej: Acme Corp)"
    if (-not $OrgName) { $OrgName = "BioVisitor X" }
}

$sslDir = Join-Path $FrontendDir "ssl"
if (-not (Test-Path $sslDir)) {
    New-Item -ItemType Directory -Path $sslDir | Out-Null
}

Write-Host ""
Write-Host "Generando certificado para: $ServerIP" -ForegroundColor Yellow
Write-Host "Destino: $sslDir"
Write-Host ""

# ---- Generar certificado autofirmado ----
# Subject Alternative Names (SAN) con IP y DNS
$sans = @("dns=$ServerIP", "dns=localhost", "ipaddress=127.0.0.1")

# Intentar agregar la IP si es una dirección válida
try {
    [System.Net.IPAddress]::Parse($ServerIP) | Out-Null
    $sans += "ipaddress=$ServerIP"
} catch {
    # ServerIP es un hostname, no una IP — solo usar DNS
}

$sanString = $sans -join "&"

try {
    $cert = New-SelfSignedCertificate `
        -Subject            "CN=$ServerIP, O=$OrgName" `
        -DnsName            @($ServerIP, "localhost") `
        -CertStoreLocation  "Cert:\LocalMachine\My" `
        -NotAfter           (Get-Date).AddYears(5) `
        -KeyAlgorithm       RSA `
        -KeyLength          2048 `
        -HashAlgorithm      SHA256 `
        -FriendlyName       "BioVisitor X SSL" `
        -KeyUsage           DigitalSignature, KeyEncipherment `
        -TextExtension      @("2.5.29.37={text}1.3.6.1.5.5.7.3.1", "2.5.29.17={text}$sanString")
} catch {
    Write-Host "[ERROR] Fallo la generacion del certificado: $_" -ForegroundColor Red
    Write-Host "Verifica que ejecutas este script como Administrador." -ForegroundColor Yellow
    Read-Host "Presiona Enter para salir"
    exit 1
}

# ---- Exportar PFX (para Node.js — sin contraseña) ----
$pfxPath = Join-Path $sslDir "server.pfx"
try {
    $pfxBytes = $cert.Export(
        [System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx
    )
    [System.IO.File]::WriteAllBytes($pfxPath, $pfxBytes)
    Write-Host "[OK] PFX generado: $pfxPath" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] No se pudo exportar el PFX: $_" -ForegroundColor Red
    exit 1
}

# ---- Exportar CRT (para importar en navegadores) ----
$crtPath = Join-Path $sslDir "server.crt"
try {
    $crtBytes = $cert.Export(
        [System.Security.Cryptography.X509Certificates.X509ContentType]::Cert
    )
    [System.IO.File]::WriteAllBytes($crtPath, $crtBytes)
    Write-Host "[OK] CRT generado: $crtPath" -ForegroundColor Green
} catch {
    Write-Host "[WARN] No se exporto el CRT (no critico): $_" -ForegroundColor Yellow
}

# ---- Importar al almacén de confianza de Windows ----
Write-Host ""
$resp = Read-Host "Importar como CA de confianza en este equipo? (S/N)"
if ($resp -ieq "S") {
    try {
        $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
        $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $store.Add($cert)
        $store.Close()
        Write-Host "[OK] Certificado importado como CA de confianza." -ForegroundColor Green
        Write-Host "     Los navegadores de este equipo no mostrarán advertencia SSL." -ForegroundColor Green
    } catch {
        Write-Host "[WARN] No se pudo importar: $_" -ForegroundColor Yellow
        Write-Host "       Ejecuta este script como Administrador." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  Certificado generado correctamente                      ║" -ForegroundColor Green
Write-Host "║  Validez: 5 años                                         ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "Siguiente paso: ejecuta scripts\2-install.bat"
Write-Host ""
Read-Host "Presiona Enter para salir"
