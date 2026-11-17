Target x86-unicode
Unicode true
Name "Desinstalar Libreta de gastos"
!ifndef SALIDA
  !define SALIDA "dist\Desinstalar Libreta de gastos.exe"
!endif
OutFile "${SALIDA}"
RequestExecutionLevel user
ShowInstDetails show
LoadLanguageFile "${NSISDIR}\Contrib\Language files\Spanish.nlf"
Page instfiles

Section
  SetShellVarContext current
  InitPluginsDir
  File "/oname=$PLUGINSDIR\desinstalar-app.ps1" "desinstalar-app.ps1"
  !ifdef RAIZ_PRUEBA
    StrCpy $0 "${RAIZ_PRUEBA}\Libreta de gastos"
    StrCpy $1 "${RAIZ_PRUEBA}\Escritorio\Libreta de gastos.lnk"
    MessageBox MB_YESNO|MB_ICONQUESTION "¿Quitar Libreta de gastos? Se conservarán los datos y respaldos." /SD IDYES IDYES continuar
  !else
    StrCpy $0 "$DOCUMENTS\Libreta de gastos"
    StrCpy $1 "$DESKTOP\Libreta de gastos.lnk"
    MessageBox MB_YESNO|MB_ICONQUESTION "¿Quitar Libreta de gastos de $0 y su acceso directo? Se conservarán los datos y respaldos." /SD IDNO IDYES continuar
  !endif
  Abort
  continuar:
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\desinstalar-app.ps1" -Aplicacion "$0" -Acceso "$1"'
    Pop $2
    StrCmp $2 "0" fin
    SetErrorLevel 1
    MessageBox MB_OK|MB_ICONSTOP "No se pudo completar la desinstalación. Cierre Libreta de gastos y revise los detalles." /SD IDOK
    Abort
  fin:
SectionEnd
