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

!ifndef UNINSTALL_LIST
  !error "Pass -DUNINSTALL_LIST=<file> (build-win.sh makes it with make_uninstall_list.py)"
!endif
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
VIAddVersionKey "LegalCopyright" "(c) 2026 SlopAMP (@HeyoPatriot) - MIT License"
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

; Append "[UTC time] installer: <message>" to SlopAMP's own log (only if SlopAMP's data folder exists),
; so an update's whole story (app quitting, installer steps, app starting) reads in one place.
; Usage: Push "message"  then  Call SlopLog
Function SlopLog
  Exch $R0
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  IfFileExists "$APPDATA\SlopAMP\*.*" 0 slopLogDone
  ${GetTime} "" "LS" $0 $1 $2 $3 $4 $5 $6
  FileOpen $7 "$APPDATA\SlopAMP\slopamp.log" a
  FileSeek $7 0 END
  FileWrite $7 "[$2-$1-$0T$4:$5:$6Z] installer: $R0$\n"
  FileClose $7
  slopLogDone:
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Pop $R0
FunctionEnd
!macro SLOPLOG PFX MSG
  !if "${PFX}" == ""
    Push "${MSG}"
    Call SlopLog
  !endif
!macroend

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
  !insertmacro SLOPLOG "${PFX}" "SlopAMP is still running; asking it to close"
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
    StrCmp $R9 0 closedasked
    IntOp $R6 $R6 + 1
    IntCmp $R6 20 force
    Sleep 500
    Goto askloop
  force:
    !insertmacro SLOPLOG "${PFX}" "SlopAMP didn't close within 10 s; ending its processes"
    DetailPrint "SlopAMP didn't quit; ending its processes."
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM SlopAMP.exe'
    Pop $R8
    Sleep 1500
    Call ${PFX}IsSlopAMPRunning
    StrCmp $R9 0 closed
    !insertmacro SLOPLOG "${PFX}" "SlopAMP could not be closed; install stopped"
    MessageBox MB_OK|MB_ICONEXCLAMATION "SlopAMP is still running and couldn't be closed. Restart Windows, then try again." /SD IDOK
    Abort
  closedasked:
    !insertmacro SLOPLOG "${PFX}" "SlopAMP closed after $R6 check(s)"
  closed:
FunctionEnd
!macroend
!insertmacro SLOPAMP_CLOSE_FUNCTIONS ""
!insertmacro SLOPAMP_CLOSE_FUNCTIONS "un."

!macro RegType EXT
  WriteRegStr HKCU "${APPKEY}\SupportedTypes" ".${EXT}" ""
!macroend
!macro PlType EXT
  WriteRegNone HKCU "Software\Classes\.${EXT}\OpenWithProgids" "SlopAMP.Playlist"
  WriteRegStr HKCU "Software\SlopAMP\Capabilities\FileAssociations" ".${EXT}" "SlopAMP.Playlist"
!macroend
!macro UnPlType EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "SlopAMP.Playlist"
!macroend

Section "SlopAMP (required)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; Clear the old app code on upgrade, but only in a folder that already holds SlopAMP.
  IfFileExists "$INSTDIR\${EXE}" 0 +2
    RMDir /r "$INSTDIR\resources\app"
  ; 2.0 ships English UI strings only: remove the other Chromium locale packs an older SlopAMP put here
  ; (exact names, listed at build time; nothing else in locales\ is touched).
  IfFileExists "$INSTDIR\${EXE}" 0 skipLocales
!ifdef DROPPED_LOCALES
  !include "${DROPPED_LOCALES}"
!endif
  skipLocales:
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
  !insertmacro RegType pls
  ; 2.4 (#6): a real playlist handler, so "Open with" and Windows' Default apps list SlopAMP for playlists.
  ; Windows doesn't let an installer make itself the default; the user picks SlopAMP once ("Always").
  WriteRegStr HKCU "Software\Classes\SlopAMP.Playlist" "" "SlopAMP playlist"
  WriteRegStr HKCU "Software\Classes\SlopAMP.Playlist\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\SlopAMP.Playlist\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  !insertmacro PlType m3u8
  !insertmacro PlType m3u
  !insertmacro PlType pls
  WriteRegStr HKCU "Software\SlopAMP\Capabilities" "ApplicationName" "SlopAMP"
  WriteRegStr HKCU "Software\SlopAMP\Capabilities" "ApplicationDescription" "SlopAMP media player"
  WriteRegStr HKCU "Software\RegisteredApplications" "SlopAMP" "Software\SlopAMP\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\SlopAMP.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\SlopAMP.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

; Update mode (SlopAMP's updater runs "Setup.exe /S /UPDATE /PID=<pid>"): reopen SlopAMP when done.
Section "-Relaunch"
  StrCmp $UpdateMode 1 0 norelaunch
    !insertmacro SLOPLOG "" "update installed in $INSTDIR; reopening SlopAMP"
    SetOutPath "$INSTDIR"
    Exec '"$INSTDIR\${EXE}"'
  norelaunch:
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
  StrCmp $R3 0 0 pidopen
    !insertmacro SLOPLOG "" "update: SlopAMP (pid $R2) already gone"
    Goto waitwin
  pidopen:
  System::Call 'kernel32::WaitForSingleObject(p R3, i 30000) i.R4'
  System::Call 'kernel32::CloseHandle(p R3)'
  !insertmacro SLOPLOG "" "update: waited for SlopAMP (pid $R2) to exit, result $R4 (0 = exited, 258 = still running after 30 s)"
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
  DeleteRegKey HKCU "Software\Classes\SlopAMP.Playlist"
  !insertmacro UnPlType m3u8
  !insertmacro UnPlType m3u
  !insertmacro UnPlType pls
  DeleteRegValue HKCU "Software\RegisteredApplications" "SlopAMP"
  DeleteRegKey HKCU "Software\SlopAMP"
  ; Only SlopAMP's own files (listed at build time from the staged app), then each folder only if it's
  ; now empty. Never RMDir /r: the install folder may be shared with other files (e.g. D:\Apps).
!ifdef DROPPED_LOCALES
  !include "${DROPPED_LOCALES}"   ; locale packs an older SlopAMP left (if the upgrade couldn't remove them)
!endif
  !include "${UNINSTALL_LIST}"
  Delete "$INSTDIR\Uninstall SlopAMP.exe"
  Delete "$INSTDIR\debug.log"
  RMDir "$INSTDIR"
  IfFileExists "$INSTDIR\*.*" 0 +2
    DetailPrint "Kept $INSTDIR because it contains other files."
  MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your SlopAMP playlist and settings?" /SD IDNO IDNO +2
    RMDir /r "$APPDATA\SlopAMP"
SectionEnd
