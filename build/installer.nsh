; PDF Studio NSIS 自定义段
; 原则：安装器绝不修改 .pdf 的默认打开方式（含 /S 静默部署），也不弹任何询问框。
;       只注册自己的 ProgID 供「打开方式」使用；想设为默认，由用户主动运行随包脚本。
;       卸载时清理自己写过的项，不留残留。全程只写 HKCU，不需要管理员权限。

!macro customInstall
  WriteRegStr HKCU "Software\Classes\PDFStudio.PDF" "" "PDF Studio 文档"
  WriteRegStr HKCU "Software\Classes\PDFStudio.PDF\DefaultIcon" "" "$INSTDIR\PDF Studio.exe,0"
  WriteRegStr HKCU "Software\Classes\PDFStudio.PDF\shell\open\command" "" '"$INSTDIR\PDF Studio.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "PDFStudio.PDF" ""
  CopyFiles /SILENT "$INSTDIR\resources\associate.cmd" "$INSTDIR\associate.cmd"
  CopyFiles /SILENT "$INSTDIR\resources\unassociate.cmd" "$INSTDIR\unassociate.cmd"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\PDFStudio.PDF"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "PDFStudio.PDF"
!macroend
