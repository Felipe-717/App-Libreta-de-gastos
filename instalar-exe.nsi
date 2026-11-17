Target x86-unicode
Unicode true
Name "Libreta de gastos"
!ifndef PORTABLE
  !error "Indica la carpeta portable con /DPORTABLE=ruta"
!endif
!ifndef SALIDA
  !define SALIDA "dist\Instalar Libreta de gastos.exe"
!endif
OutFile "${SALIDA}"
InstallDir "$DOCUMENTS\Libreta de gastos"
RequestExecutionLevel user
ShowInstDetails show

LoadLanguageFile "${NSISDIR}\Contrib\Language files\Spanish.nlf"
Page instfiles

Section "Instalar"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  SetOverwrite on
  ClearErrors
  File "${PORTABLE}\Libreta de gastos.exe"
  IfErrors fallo
  SetOutPath "$INSTDIR\_internal"
  File /r "${PORTABLE}\_internal\*"
  IfErrors fallo
  SetOutPath "$INSTDIR"
  !ifdef ESCRITORIO_PRUEBA
    CreateDirectory "${ESCRITORIO_PRUEBA}"
    CreateShortcut "${ESCRITORIO_PRUEBA}\Libreta de gastos.lnk" "$INSTDIR\Libreta de gastos.exe" "" "$INSTDIR\Libreta de gastos.exe" 0
  !else
    CreateShortcut "$DESKTOP\Libreta de gastos.lnk" "$INSTDIR\Libreta de gastos.exe" "" "$INSTDIR\Libreta de gastos.exe" 0
  !endif
  IfErrors fallo
  Goto fin
  fallo:
    SetErrorLevel 1
    MessageBox MB_OK|MB_ICONSTOP "No se pudo completar la instalacion. Cierra la aplicacion y vuelve a intentarlo. Tus datos se conservan."
    Abort
  fin:
SectionEnd
