; SlopAMP — single-file portable launcher.
; Unpacks once to %TEMP%\SlopAMP-<version> (reused on later runs) and keeps
; the playlist/settings in a "SlopAMP Data" folder next to this .exe.
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "1.1.1"
!endif

Name "SlopAMP Portable"
OutFile "${OUTDIR}\SlopAMP-Portable-${VERSION}.exe"
Icon "${BUILDDIR}\icon.ico"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SlopAMP Portable"
VIAddVersionKey "FileDescription" "SlopAMP Media Player (portable)"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "(c) 2026 SlopAMP (@HeyoPatriot) - MIT License"
VIAddVersionKey "CompanyName" "SlopAMP"

Section
  StrCpy $INSTDIR "$TEMP\SlopAMP-${VERSION}-portable"
  IfFileExists "$INSTDIR\.complete-${BUILDID}" run
    RMDir /r "$INSTDIR"
    SetOutPath "$INSTDIR"
    File /r "${STAGE}\*.*"
    FileOpen $0 "$INSTDIR\.complete-${BUILDID}" w
    FileClose $0
  run:
  ; Portable data folder next to the exe, if that location is writable.
  ClearErrors
  CreateDirectory "$EXEDIR\SlopAMP Data"
  IfFileExists "$EXEDIR\SlopAMP Data\*.*" 0 nodata
    System::Call 'Kernel32::SetEnvironmentVariable(t "SLOPAMP_DATA_DIR", t "$EXEDIR\SlopAMP Data")i'
  nodata:
  ; Tells SlopAMP it is the portable copy (it then never tries to install updates).
  System::Call 'Kernel32::SetEnvironmentVariable(t "SLOPAMP_PORTABLE", t "1")i'
  ; 2.4: the portable .exe itself, so "?" -> Make SlopAMP open playlists... registers this file (not the temp copy)
  System::Call 'Kernel32::SetEnvironmentVariable(t "SLOPAMP_PORTABLE_EXE", t "$EXEPATH")i'
  ${GetParameters} $1
  SetOutPath "$INSTDIR"
  Exec '"$INSTDIR\SlopAMP.exe" $1'
SectionEnd
