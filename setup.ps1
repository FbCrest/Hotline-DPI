# ============================================================
# Hotline DPI - Setup Script
# Tải GoodbyeDPI và dnsproxy về thư mục bin\
# Chạy 1 lần trước khi dùng app
# ============================================================

$ErrorActionPreference = 'Stop'
$BinDir = "$PSScriptRoot\bin"

function Write-Step($msg) {
    Write-Host "`n>> $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "   OK  $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "   !!  $msg" -ForegroundColor Yellow
}

function Write-Err($msg) {
    Write-Host "  ERR  $msg" -ForegroundColor Red
}

# Tạo thư mục
Write-Step "Tạo thư mục bin..."
New-Item -ItemType Directory -Force -Path "$BinDir\goodbyedpi" | Out-Null
New-Item -ItemType Directory -Force -Path "$BinDir\dnsproxy"   | Out-Null
New-Item -ItemType Directory -Force -Path "$BinDir\zapret"     | Out-Null
Write-OK "Thư mục đã sẵn sàng"

# ---- 1. GoodbyeDPI ----
Write-Step "Tải GoodbyeDPI..."
$gdpiDir = "$BinDir\goodbyedpi"
$gdpiExe = "$gdpiDir\goodbyedpi.exe"

if (-not (Test-Path $gdpiExe)) {
    try {
        # Lấy bản mới nhất từ GitHub
        $release = Invoke-RestMethod "https://api.github.com/repos/ValdikSS/GoodbyeDPI/releases/latest"
        $asset = $release.assets | Where-Object { $_.name -like "*x86_64*" -or $_.name -like "*win64*" } | Select-Object -First 1
        if (-not $asset) {
            $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
        }

        if ($asset) {
            $zipPath = "$env:TEMP\goodbyedpi.zip"
            Write-Host "   Đang tải $($asset.name)..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing

            Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\gdpi_extract" -Force
            # Tìm exe trong extracted
            $exe = Get-ChildItem "$env:TEMP\gdpi_extract" -Recurse -Filter "goodbyedpi.exe" | Select-Object -First 1
            if ($exe) {
                Copy-Item $exe.FullName -Destination $gdpiExe -Force
                # Copy WinDivert jika ada
                Get-ChildItem "$env:TEMP\gdpi_extract" -Recurse -Filter "WinDivert*" | ForEach-Object {
                    Copy-Item $_.FullName -Destination $gdpiDir -Force
                }
                Write-OK "GoodbyeDPI đã tải: $($release.tag_name)"
            } else {
                Write-Warn "Không tìm thấy goodbyedpi.exe trong archive"
            }
            Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
            Remove-Item "$env:TEMP\gdpi_extract" -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            Write-Warn "Không tìm thấy asset phù hợp"
        }
    } catch {
        Write-Warn "Tải GoodbyeDPI thất bại: $_"
        Write-Warn "Tải thủ công từ: https://github.com/ValdikSS/GoodbyeDPI/releases"
        Write-Warn "Giải nén vào: $gdpiDir"
    }
} else {
    Write-OK "GoodbyeDPI đã có sẵn"
}

# ---- 2. dnsproxy ----
Write-Step "Tải dnsproxy (AdGuard)..."
$dnsDir = "$BinDir\dnsproxy"
$dnsExe = "$dnsDir\dnsproxy.exe"

if (-not (Test-Path $dnsExe)) {
    try {
        $release = Invoke-RestMethod "https://api.github.com/repos/AdguardTeam/dnsproxy/releases/latest"
        $asset = $release.assets | Where-Object { $_.name -like "*windows*amd64*" -and $_.name -like "*.zip" } | Select-Object -First 1

        if ($asset) {
            $zipPath = "$env:TEMP\dnsproxy.zip"
            Write-Host "   Đang tải $($asset.name)..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing

            Expand-Archive -Path $zipPath -DestinationPath "$env:TEMP\dns_extract" -Force
            $exe = Get-ChildItem "$env:TEMP\dns_extract" -Recurse -Filter "dnsproxy.exe" | Select-Object -First 1
            if ($exe) {
                Copy-Item $exe.FullName -Destination $dnsExe -Force
                Write-OK "dnsproxy đã tải: $($release.tag_name)"
            }
            Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
            Remove-Item "$env:TEMP\dns_extract" -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Warn "Tải dnsproxy thất bại: $_"
        Write-Warn "Tải thủ công từ: https://github.com/AdguardTeam/dnsproxy/releases"
        Write-Warn "Giải nén vào: $dnsDir"
    }
} else {
    Write-OK "dnsproxy đã có sẵn"
}

# ---- 3. Node dependencies ----
Write-Step "Cài đặt Node.js dependencies..."
Set-Location $PSScriptRoot
try {
    npm install --prefer-offline 2>&1 | Select-String -NotMatch "npm warn" | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
    Write-OK "npm install hoàn tất"
} catch {
    Write-Err "npm install thất bại: $_"
}

# ---- Kết quả ----
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "  Hotline DPI - Setup hoàn tất!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan

$gdpiOk  = Test-Path "$BinDir\goodbyedpi\goodbyedpi.exe"
$dnsOk   = Test-Path "$BinDir\dnsproxy\dnsproxy.exe"

Write-Host "  GoodbyeDPI : $(if ($gdpiOk) { 'OK' } else { 'THIẾU - tải thủ công' })" -ForegroundColor $(if ($gdpiOk) { 'Green' } else { 'Yellow' })
Write-Host "  dnsproxy   : $(if ($dnsOk)  { 'OK' } else { 'THIẾU - tải thủ công' })" -ForegroundColor $(if ($dnsOk)  { 'Green' } else { 'Yellow' })
Write-Host ""
Write-Host "  Chạy app:" -ForegroundColor White
Write-Host "    npm start" -ForegroundColor Cyan
Write-Host ""

if (-not $gdpiOk) {
    Write-Host "  [!] Tải GoodbyeDPI thủ công:" -ForegroundColor Yellow
    Write-Host "      https://github.com/ValdikSS/GoodbyeDPI/releases" -ForegroundColor Gray
    Write-Host "      Giải nén tất cả file vào: $BinDir\goodbyedpi\" -ForegroundColor Gray
    Write-Host ""
}
