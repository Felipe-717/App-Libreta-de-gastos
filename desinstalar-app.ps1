param(
    [Parameter(Mandatory = $true)][string]$Aplicacion,
    [Parameter(Mandatory = $true)][string]$Acceso
)

$ErrorActionPreference = 'Stop'
$raiz = [IO.Path]::GetFullPath($Aplicacion)
$exe = Join-Path $raiz 'Libreta de gastos.exe'
$archivos = Join-Path $raiz '_internal'

if (Test-Path -LiteralPath $raiz) {
    $carpeta = Get-Item -LiteralPath $raiz -Force
    if (-not $carpeta.PSIsContainer -or ($carpeta.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'La carpeta de la aplicación no es una carpeta local válida.'
    }
    if (Test-Path -LiteralPath $archivos) {
        $dependencias = Get-Item -LiteralPath $archivos -Force
        if (-not $dependencias.PSIsContainer -or ($dependencias.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            -not $dependencias.FullName.StartsWith($carpeta.FullName + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'La carpeta de dependencias está fuera de la instalación.'
        }
        if (Get-ChildItem -LiteralPath $archivos -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) {
            throw 'Las dependencias contienen enlaces. No se borrarán automáticamente.'
        }
    }
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
        # Windows rechaza borrar el ejecutable mientras está en uso.
        Remove-Item -LiteralPath $exe -Force
    }
    if (Test-Path -LiteralPath $archivos) {
        Remove-Item -LiteralPath $archivos -Recurse -Force
    }
    if (-not (Get-ChildItem -LiteralPath $raiz -Force | Select-Object -First 1)) {
        [IO.Directory]::Delete($raiz)
    }
}

if (Test-Path -LiteralPath $Acceso -PathType Leaf) {
    $shell = New-Object -ComObject WScript.Shell
    $destino = $shell.CreateShortcut($Acceso).TargetPath
    if ($destino -and [string]::Equals([IO.Path]::GetFullPath($destino), $exe, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $Acceso -Force
    }
}
Write-Output 'Desinstalación completada. Datos y respaldos conservados.'
