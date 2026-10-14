@echo off
chcp 65001 >nul
setlocal

rem ============================================================
rem  Install the Toolbar Fade plugin into the SiYuan workspace.
rem  Right-click -> Run, or double-click this file.
rem  If the copy fails, right-click -> "Run as administrator".
rem ============================================================

set "PLUGIN=plugin-toolbar-fade"
set "SRC=%~dp0.."
set "WORKSPACE=D:\Program Files\思源笔记\科研工作"
set "PLUGINS=%WORKSPACE%\data\plugins"
set "TARGET=%PLUGINS%\%PLUGIN%"

echo.
echo   Source   : %SRC%
echo   Target   : %TARGET%
echo.

if not exist "%WORKSPACE%\conf\conf.json" (
  echo [ERROR] Not a SiYuan workspace: "%WORKSPACE%"
  echo         Edit the WORKSPACE line in this file, or copy the plugin folder manually.
  goto :end
)
if not exist "%SRC%\plugin.json" (
  echo [ERROR] plugin.json not found in "%SRC%"
  echo         Run this file from the plugin's tools folder.
  goto :end
)

tasklist /FI "IMAGENAME eq SiYuan.exe" 2>nul | find /I "SiYuan.exe" >nul
if not errorlevel 1 (
  echo [ERROR] SiYuan is running. Please quit SiYuan completely, then run this again.
  goto :end
)

if not exist "%PLUGINS%" mkdir "%PLUGINS%"
if exist "%TARGET%" (
  echo   Removing previous copy...
  rmdir /S /Q "%TARGET%"
)
mkdir "%TARGET%"
xcopy "%SRC%" "%TARGET%\" /E /I /Y /Q >nul
if errorlevel 1 (
  echo [ERROR] Copy failed. Try running this file as administrator.
  goto :end
)

if not exist "%TARGET%\plugin.json" (
  echo [ERROR] plugin.json missing after copy.
  goto :end
)

echo   Installed: %TARGET%
echo.
echo   Next: start SiYuan - Settings - Bazaar - Downloaded - enable "Toolbar Fade".
echo.

:end
echo Press any key to close...
pause >nul
endlocal
