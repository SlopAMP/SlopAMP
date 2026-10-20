; SlopAMP — Windows installer (per-user, no admin rights needed)
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"
!include "StrFunc.nsh"
${StrStr}
${UnStrStr}

!ifndef VERSION
  !define VERSION "1.1.1"
!endif
!define APPNAME "SlopAMP"
!define EXE "SlopAMP.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SlopAMP"
!define APPKEY "Software\Classes\Applications\SlopAMP.exe"

Name "${APPNAME}"
OutFile "${OUTDIR}\SlopAMP-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\SlopAMP"
InstallDirRegKey HKCU "Software\SlopAMP" "InstallDir"
RequestExecutionLevel user
BrandingText "SlopAMP ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SlopAMP"
VIAddVersionKey "FileDescription" "SlopAMP Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "(c) 2026 bob - MIT License"
VIAddVersionKey "CompanyName" "SlopAMP"

!define MUI_ICON "${BUILDDIR}\icon.ico"
!define MUI_UNICON "${BUILDDIR}\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install SlopAMP ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "SlopAMP is a retro-styled media player for your video and music files, plus YouTube videos through YouTube's official embedded player.$\r$\n$\r$\nNo administrator rights are needed. SlopAMP installs just for you.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch SlopAMP"
!define MUI_COMPONENTSPAGE_NODESC

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Var UpdateMode

; Close a running SlopAMP before replacing or removing its files. Also finds copies with no visible window
; (a hidden or stuck SlopAMP, or one running from the portable exe's temp folder): first it asks them to
; quit, and if they're still there after 10 s it ends them. Interactive installs ask the user first.
!macro SLOPAMP_CLOSE_FUNCTIONS PFX
Function ${PFX}IsSlopAMPRunning   ; sets $R9 to 1 if a SlopAMP window or SlopAMP.exe process exists
  StrCpy $R9 0
  FindWindow $R8 "Chrome_WidgetWin_1" "SlopAMP"
  StrCmp $R8 0 +3
    StrCpy $R9 1
    Return
  nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /NH /FI "IMAGENAME eq SlopAMP.exe"'
  Pop $R8
  Pop $R7
  !if "${PFX}" == "un."
    ${UnStrStr} $R7 $R7 "SlopAMP.exe"
  !else
    ${StrStr} $R7 $R7 "SlopAMP.exe"
  !endif
  StrCmp $R7 "" +2
    StrCpy $R9 1
FunctionEnd

Function ${PFX}CloseSlopAMP
  Call ${PFX}IsSlopAMPRunning
  StrCmp $R9 0 closed
  IfSilent asked
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "SlopAMP is running (maybe hidden in the background).$\r$\n$\r$\nClick OK to close it. Your playlists and settings are kept." IDOK asked
    Abort
  asked:
  StrCpy $R6 0
  askloop:
    FindWindow $R8 "Chrome_WidgetWin_1" "SlopAMP"
    StrCmp $R8 0 +2
      SendMessage $R8 0x0010 0 0 /TIMEOUT=1000   ; WM_CLOSE: quit normally (saves playlists)
    Call ${PFX}IsSlopAMPRunning
    StrCmp $R9 0 closed
    IntOp $R6 $R6 + 1
    IntCmp $R6 20 force
    Sleep 500
    Goto askloop
  force:
    DetailPrint "SlopAMP didn't quit; ending its processes."
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM SlopAMP.exe'
    Pop $R8
    Sleep 1500
    Call ${PFX}IsSlopAMPRunning
    StrCmp $R9 0 closed
    MessageBox MB_OK|MB_ICONEXCLAMATION "SlopAMP is still running and couldn't be closed. Restart Windows, then try again." /SD IDOK
    Abort
  closed:
FunctionEnd
!macroend
!insertmacro SLOPAMP_CLOSE_FUNCTIONS ""
!insertmacro SLOPAMP_CLOSE_FUNCTIONS "un."

!macro RegType EXT
  WriteRegStr HKCU "${APPKEY}\SupportedTypes" ".${EXT}" ""
!macroend

Section "SlopAMP (required)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources\app"
  File /r "${STAGE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall SlopAMP.exe"
  WriteRegStr HKCU "Software\SlopAMP" "InstallDir" "$INSTDIR"

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "SlopAMP"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "SlopAMP"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall SlopAMP.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall SlopAMP.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"

  ; Show up in Explorer's "Open with" menu (does not change your default players).
  WriteRegStr HKCU "${APPKEY}" "FriendlyAppName" "SlopAMP"
  WriteRegStr HKCU "${APPKEY}\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${APPKEY}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  !insertmacro RegType mp4
  !insertmacro RegType m4v
  !insertmacro RegType mkv
  !insertmacro RegType avi
  !insertmacro RegType mov
  !insertmacro RegType wmv
  !insertmacro RegType webm
  !insertmacro RegType flv
  !insertmacro RegType mpg
  !insertmacro RegType mpeg
  !insertmacro RegType ts
  !insertmacro RegType m2ts
  !insertmacro RegType 3gp
  !insertmacro RegType mp3
  !insertmacro RegType flac
  !insertmacro RegType wav
  !insertmacro RegType ogg
  !insertmacro RegType opus
  !insertmacro RegType m4a
  !insertmacro RegType aac
  !insertmacro RegType wma
  !insertmacro RegType m3u
  !insertmacro RegType m3u8

  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\SlopAMP.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\SlopAMP.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

; Update mode (SlopAMP's updater runs "Setup.exe /S /UPDATE /PID=<pid>"): reopen SlopAMP when done.
Section "-Relaunch"
  StrCmp $UpdateMode 1 0 +3
    SetOutPath "$INSTDIR"
    Exec '"$INSTDIR\${EXE}"'
SectionEnd

Function .onInit
  StrCpy $UpdateMode 0
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/UPDATE" $R1
  IfErrors normal
  StrCpy $UpdateMode 1
  ; Wait (up to 30 s) for the SlopAMP process that started us to exit, so its files can be replaced.
  ClearErrors
  ${GetOptions} $R0 "/PID=" $R2
  IfErrors waitwin
  System::Call 'kernel32::OpenProcess(i 0x00100000, i 0, i R2) p.R3'
  StrCmp $R3 0 waitwin
  System::Call 'kernel32::WaitForSingleObject(p R3, i 30000) i'
  System::Call 'kernel32::CloseHandle(p R3)'
  waitwin:
  ; Keep the user's choice: no desktop shortcut on update unless there was one.
  IfFileExists "$DESKTOP\SlopAMP.lnk" normal
    !insertmacro UnselectSection ${SecDesktop}
  normal:
  Call CloseSlopAMP
FunctionEnd

Section "Uninstall"
  Call un.CloseSlopAMP
  Delete "$SMPROGRAMS\SlopAMP.lnk"
  Delete "$DESKTOP\SlopAMP.lnk"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "${APPKEY}"
  DeleteRegKey HKCU "Software\SlopAMP"
  RMDir /r "$INSTDIR"
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your SlopAMP playlist and settings?" /SD IDNO IDNO +2
    RMDir /r "$APPDATA\SlopAMP"
SectionEnd
