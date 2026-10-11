@echo off
:: ============================================================
::  Hotline DPI - Build Script
::  Output: dist\Hotline DPI-1.0.0-win.zip
::  Giai nen va chay Hotline DPI.exe la xong, khong can cai dat
:: ============================================================
title Hotline DPI - Build
cd /d "%~dp0"

echo.
echo  ============================================================
echo   Hotline DPI - Build
echo  ============================================================
echo.

:: Kiem tra Node.js
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo  [LOI] Khong tim thay Node.js. Cai dat tai nodejs.org
    pause & exit /b 1
)

:: Kiem tra dependencies
if not exist "node_modules\" (
    echo  [1/3] Cai dat dependencies...
    npm install --legacy-peer-deps
) else (
    echo  [1/3] Dependencies da co san.
)

:: Tao icon
echo  [2/3] Tao icon...
python -c "
from PIL import Image
src = 'assets/Hotline DPI.png'
img = Image.open(src).convert('RGBA')
def sq(im, s):
    c = Image.new('RGBA',(s,s),(0,0,0,0))
    im2 = im.copy(); im2.thumbnail((s,s),Image.LANCZOS)
    c.paste(im2,((s-im2.width)//2,(s-im2.height)//2),im2)
    return c
sizes=[16,24,32,48,64,128,256]
imgs=[sq(img,s) for s in sizes]
imgs[-1].save('assets/icon.ico',format='ICO',append_images=imgs[:-1],sizes=[(s,s) for s in sizes])
sq(img,256).save('assets/icon.png')
sq(img,32).save('assets/tray.png')
print('OK')
" 2>nul || echo  [WARN] Giu nguyen icon cu.

:: Xoa build cu
if exist "dist\win-unpacked" rmdir /s /q "dist\win-unpacked"

:: Build
echo  [3/3] Dang build ZIP...
echo  (Khoang 1-3 phut, vui long doi...)
echo.
set CSC_IDENTITY_AUTO_DISCOVERY=false
node node_modules/electron-builder/cli.js --win zip --x64

if %errorLevel% equ 0 (
    echo.
    echo  ============================================================
    echo   BUILD THANH CONG!
    echo.
    echo   dist\Hotline DPI-1.0.0-win.zip
    echo   Giai nen ra thu muc bat ky, chay Hotline DPI.exe
    echo  ============================================================
    echo.
    explorer dist
) else (
    echo.
    echo  [LOI] Build that bai.
)

pause
