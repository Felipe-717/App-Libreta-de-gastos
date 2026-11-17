# Prepara el entorno propio de Python (.venv) y crea el acceso directo en el escritorio.
# Uso: clic derecho > Ejecutar con PowerShell, o en una terminal:
#   powershell -ExecutionPolicy Bypass -File instalar.ps1

$ErrorActionPreference = "Stop"
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $base ".venv"
$pythonw = Join-Path $venv "Scripts\pythonw.exe"

if (-not (Test-Path $pythonw)) {
    Write-Host "Creando el entorno .venv..."
    python -m venv $venv
}
& (Join-Path $venv "Scripts\python.exe") -m pip install --quiet --upgrade pip
& (Join-Path $venv "Scripts\python.exe") -m pip install --quiet -r (Join-Path $base "requirements.txt")

$escritorio = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$acceso = $shell.CreateShortcut((Join-Path $escritorio "Libreta de gastos.lnk"))
$acceso.TargetPath = $pythonw
$acceso.Arguments = '"' + (Join-Path $base "app.pyw") + '"'
$acceso.WorkingDirectory = $base
$acceso.IconLocation = (Join-Path $base "static\icono.ico") + ",0"
$acceso.Description = "Libreta de gastos"
$acceso.Save()

Write-Host "Listo. Acceso directo creado en $escritorio"
