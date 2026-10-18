; Offer MyDocs for every file without replacing Windows' chosen default apps.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\*\shell\MyDocs" "" "Open with MyDocs"
  WriteRegStr SHCTX "Software\Classes\*\shell\MyDocs" "Icon" '"$INSTDIR\my-doc.exe",0'
  WriteRegStr SHCTX "Software\Classes\*\shell\MyDocs\command" "" '"$INSTDIR\my-doc.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\MyDocs"
!macroend
