# Compila una carpeta portable de Windows. Requiere Python y acceso a PyPI.
$ErrorActionPreference = "Stop"
$base = $PSScriptRoot
$python = Join-Path $base ".venv\Scripts\python.exe"
$destino = Join-Path $base "dist\Libreta de gastos"

if (Test-Path -LiteralPath $destino) {
    throw "Ya existe '$destino'. Muévela o cámbiale el nombre antes de compilar para proteger sus datos."
}
if (-not (Test-Path -LiteralPath $python)) {
    python -m venv (Join-Path $base ".venv")
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el entorno de Python." }
}
& $python -m pip install -r (Join-Path $base "requirements.txt") pyinstaller
if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar las dependencias de compilación." }

& $python -m PyInstaller --noconfirm --onedir --windowed --name "Libreta de gastos" `
    --icon (Join-Path $base "static\icono.ico") --add-data "$(Join-Path $base 'static');static" `
    --distpath (Join-Path $base "dist") --workpath (Join-Path $base "build\pyinstaller") `
    --specpath (Join-Path $base "build") (Join-Path $base "app.pyw")
if ($LASTEXITCODE -ne 0) { throw "No se pudo compilar la aplicación." }
Write-Host "Listo: $destino"
