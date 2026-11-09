Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them with the values from ProjectInfo.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
####
## Include the wails tools
####
!include "wails_tools.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_ABORTWARNING

# Variables for existing installation lifecycle
Var IsAlreadyInstalled
Var InstallMode       # "INSTALL", "UPDATE", "REINSTALL", "REMOVE"
Var RemoveHistory     # "0" or "1"
Var Dialog
Var RadioUpdate
Var RadioReinstall
Var RadioRemove
Var CheckRemoveHistory
Var LabelUpdateNote
Var LabelRemoveNote

!insertmacro MUI_PAGE_WELCOME

# Custom Page: displayed if inChat is already installed
Page custom PageExistingInstall PageExistingInstallLeave

!define MUI_PAGE_CUSTOMFUNCTION_PRE DirectoryPre
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro GetParent

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe"
InstallDir "$PROGRAMFILES64\${INFO_PRODUCTNAME}"
ShowInstDetails show

Function .onInit
    !insertmacro wails.checkArchitecture

    StrCpy $IsAlreadyInstalled "0"
    StrCpy $InstallMode "INSTALL"
    StrCpy $RemoveHistory "0"

    # Check 64-bit and 32-bit registry for existing installation under both inChat and inChatinChat keys
    SetRegView 64
    ReadRegStr $0 HKLM "${UNINST_KEY}" "UninstallString"
    ${If} $0 == ""
        ReadRegStr $0 HKCU "${UNINST_KEY}" "UninstallString"
    ${EndIf}
    ${If} $0 == ""
        ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\inChat" "UninstallString"
    ${EndIf}
    ${If} $0 == ""
        ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inChat" "UninstallString"
    ${EndIf}

    # Also check 32-bit registry view if not found yet
    ${If} $0 == ""
        SetRegView 32
        ReadRegStr $0 HKLM "${UNINST_KEY}" "UninstallString"
        ${If} $0 == ""
            ReadRegStr $0 HKCU "${UNINST_KEY}" "UninstallString"
        ${EndIf}
        ${If} $0 == ""
            ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\inChat" "UninstallString"
        ${EndIf}
        ${If} $0 == ""
            ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\inChat" "UninstallString"
        ${EndIf}
        SetRegView 64
    ${EndIf}

    ${If} $0 != ""
        StrCpy $IsAlreadyInstalled "1"
        ReadRegStr $1 HKLM "${UNINST_KEY}" "InstallLocation"
        ${If} $1 == ""
            ReadRegStr $1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\inChat" "InstallLocation"
        ${EndIf}
        ${If} $1 != ""
            StrCpy $INSTDIR $1
        ${Else}
            ReadRegStr $2 HKLM "${UNINST_KEY}" "DisplayIcon"
            ${If} $2 == ""
                ReadRegStr $2 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\inChat" "DisplayIcon"
            ${EndIf}
            ${If} $2 != ""
                ${GetParent} "$2" $INSTDIR
            ${EndIf}
        ${EndIf}
    ${Else}
        # Fallback check files on disk across common install locations
        IfFileExists "$INSTDIR\${PRODUCT_EXECUTABLE}" found_existing
        IfFileExists "$PROGRAMFILES64\inChat\${PRODUCT_EXECUTABLE}" found_prog64
        IfFileExists "$PROGRAMFILES\inChat\${PRODUCT_EXECUTABLE}" found_prog32
        IfFileExists "$PROGRAMFILES64\inChat\inChat\${PRODUCT_EXECUTABLE}" found_nested
        IfFileExists "$LOCALAPPDATA\Programs\inChat\${PRODUCT_EXECUTABLE}" found_local
        Goto not_installed

        found_prog64:
            StrCpy $INSTDIR "$PROGRAMFILES64\inChat"
            Goto found_existing
        found_prog32:
            StrCpy $INSTDIR "$PROGRAMFILES\inChat"
            Goto found_existing
        found_nested:
            StrCpy $INSTDIR "$PROGRAMFILES64\inChat\inChat"
            Goto found_existing
        found_local:
            StrCpy $INSTDIR "$LOCALAPPDATA\Programs\inChat"
            Goto found_existing
        found_existing:
            StrCpy $IsAlreadyInstalled "1"
        not_installed:
    ${EndIf}
FunctionEnd

Function DirectoryPre
    ${If} $InstallMode == "UPDATE"
        Abort # Skip directory choice when updating existing installation
    ${EndIf}
FunctionEnd

Function PageExistingInstall
    ${If} $IsAlreadyInstalled != "1"
        Abort # Skip this page for fresh install
    ${EndIf}

    nsDialogs::Create 1018
    Pop $Dialog
    ${If} $Dialog == error
        Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "Existing Installation Detected" "Choose whether to update, reinstall, or remove ${INFO_PRODUCTNAME}."

    ${NSD_CreateLabel} 0 0 100% 24u "${INFO_PRODUCTNAME} is already installed on this computer.$\r$\nSelect how you would like to proceed:"
    Pop $0

    # 1. Update option
    ${NSD_CreateRadioButton} 0 28u 100% 12u "&Update ${INFO_PRODUCTNAME} (Recommended)"
    Pop $RadioUpdate
    ${NSD_CreateLabel} 12u 42u 88% 18u "Updates application binaries to the newest version. All chat history, department rooms, and settings will remain untouched."
    Pop $LabelUpdateNote

    # 2. Reinstall option
    ${NSD_CreateRadioButton} 0 64u 100% 12u "&Reinstall ${INFO_PRODUCTNAME}"
    Pop $RadioReinstall
    ${NSD_CreateCheckbox} 12u 78u 88% 12u "Remove chat history and user data (%APPDATA%\inChat)"
    Pop $CheckRemoveHistory

    # 3. Remove option
    ${NSD_CreateRadioButton} 0 94u 100% 12u "Re&move (Uninstall) ${INFO_PRODUCTNAME}"
    Pop $RadioRemove
    ${NSD_CreateLabel} 12u 108u 88% 18u "Completely uninstalls ${INFO_PRODUCTNAME} and firewall rules from this computer."
    Pop $LabelRemoveNote

    # Default: Update checked, checkbox unchecked & disabled
    ${NSD_Check} $RadioUpdate
    ${NSD_Uncheck} $CheckRemoveHistory
    EnableWindow $CheckRemoveHistory 0

    ${NSD_OnClick} $RadioUpdate OnRadioUpdateClick
    ${NSD_OnClick} $RadioReinstall OnRadioReinstallClick
    ${NSD_OnClick} $RadioRemove OnRadioRemoveClick

    nsDialogs::Show
FunctionEnd

Function OnRadioUpdateClick
    Pop $0
    ${NSD_Check} $RadioUpdate
    ${NSD_Uncheck} $RadioReinstall
    ${NSD_Uncheck} $RadioRemove
    ${NSD_Uncheck} $CheckRemoveHistory
    EnableWindow $CheckRemoveHistory 0
FunctionEnd

Function OnRadioReinstallClick
    Pop $0
    ${NSD_Uncheck} $RadioUpdate
    ${NSD_Check} $RadioReinstall
    ${NSD_Uncheck} $RadioRemove
    EnableWindow $CheckRemoveHistory 1
FunctionEnd

Function OnRadioRemoveClick
    Pop $0
    ${NSD_Uncheck} $RadioUpdate
    ${NSD_Uncheck} $RadioReinstall
    ${NSD_Check} $RadioRemove
    EnableWindow $CheckRemoveHistory 1
FunctionEnd

Function PageExistingInstallLeave
    ${NSD_GetState} $RadioUpdate $0
    ${If} $0 == ${BST_CHECKED}
        StrCpy $InstallMode "UPDATE"
        StrCpy $RemoveHistory "0"
        Return
    ${EndIf}

    ${NSD_GetState} $RadioReinstall $0
    ${If} $0 == ${BST_CHECKED}
        StrCpy $InstallMode "REINSTALL"
        ${NSD_GetState} $CheckRemoveHistory $1
        ${If} $1 == ${BST_CHECKED}
            StrCpy $RemoveHistory "1"
        ${Else}
            StrCpy $RemoveHistory "0"
        ${EndIf}
        Return
    ${EndIf}

    ${NSD_GetState} $RadioRemove $0
    ${If} $0 == ${BST_CHECKED}
        StrCpy $InstallMode "REMOVE"
        ${NSD_GetState} $CheckRemoveHistory $1
        ${If} $1 == ${BST_CHECKED}
            StrCpy $RemoveHistory "1"
        ${Else}
            StrCpy $RemoveHistory "0"
        ${EndIf}

        MessageBox MB_YESNO|MB_ICONQUESTION "Are you sure you want to completely uninstall ${INFO_PRODUCTNAME}?" IDYES do_remove
        Abort # User cancelled, stay on page

        do_remove:
        # Terminate running inChat before uninstalling
        ExecWait 'taskkill /F /IM "${PRODUCT_EXECUTABLE}"'

        ${If} $RemoveHistory == "1"
            RMDir /r "$APPDATA\inChat"
            RMDir /r "$LOCALAPPDATA\inChat"
            RMDir /r "$APPDATA\${PRODUCT_EXECUTABLE}"
        ${EndIf}

        IfFileExists "$INSTDIR\uninstall.exe" 0 no_uninst
            ExecWait '"$INSTDIR\uninstall.exe" /S _?=$INSTDIR'
            Goto done_uninst
        no_uninst:
            RMDir /r "$INSTDIR"
            Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
            Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"
            ExecWait 'netsh advfirewall firewall delete rule name="inChat Discovery"'
            ExecWait 'netsh advfirewall firewall delete rule name="inChat Control"'
            DeleteRegKey HKLM "${UNINST_KEY}"
        done_uninst:
            MessageBox MB_OK|MB_ICONINFORMATION "${INFO_PRODUCTNAME} has been uninstalled successfully."
            Quit
    ${EndIf}
FunctionEnd

Section
    !insertmacro wails.setShellContext

    # Terminate running inChat instance before writing new binaries
    DetailPrint "Closing running instances of inChat..."
    ExecWait 'taskkill /F /IM "${PRODUCT_EXECUTABLE}"'

    ${If} $RemoveHistory == "1"
        DetailPrint "Removing chat history and user data as requested..."
        RMDir /r "$APPDATA\inChat"
        RMDir /r "$LOCALAPPDATA\inChat"
        RMDir /r "$APPDATA\${PRODUCT_EXECUTABLE}"
    ${EndIf}

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    # Auto-start on boot: register in HKCU Run key
    DetailPrint "Configuring auto-start on Windows boot..."
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "inChat" '"$INSTDIR\${PRODUCT_EXECUTABLE}"'

    # Standard Windows Firewall: allow LAN discovery (UDP 45450) and the control
    # channel (TCP 45451) for the installed binary.
    DetailPrint "Adding Windows Firewall rules for inChat..."
    ExecWait 'netsh advfirewall firewall delete rule name="inChat Discovery"'
    ExecWait 'netsh advfirewall firewall delete rule name="inChat Control"'
    ExecWait 'netsh advfirewall firewall add rule name="inChat Discovery" dir=in action=allow protocol=UDP localport=45450 program="$INSTDIR\${PRODUCT_EXECUTABLE}"'
    ExecWait 'netsh advfirewall firewall add rule name="inChat Control" dir=in action=allow protocol=TCP localport=45451 program="$INSTDIR\${PRODUCT_EXECUTABLE}"'

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols

    !insertmacro wails.writeUninstaller

    # Also record InstallLocation in registry for reliable detection
    SetRegView 64
    WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    # Close running inChat if any
    ExecWait 'taskkill /F /IM "${PRODUCT_EXECUTABLE}"'

    # Ask user if they wish to remove chat history and user data
    IfSilent skip_uninst_prompt
    MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to completely remove your chat history, department rooms, and user data (%APPDATA%\inChat)?" IDNO skip_remove_history
    RMDir /r "$APPDATA\inChat"
    RMDir /r "$LOCALAPPDATA\inChat"
    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}"
    Goto skip_uninst_prompt

    skip_remove_history:
    DetailPrint "Keeping chat history, department rooms, and user settings."

    skip_uninst_prompt:
    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    # Remove auto-start from registry
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "inChat"

    # Remove the firewall rules the installer created.
    ExecWait 'netsh advfirewall firewall delete rule name="inChat Discovery"'
    ExecWait 'netsh advfirewall firewall delete rule name="inChat Control"'

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
