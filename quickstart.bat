@echo off
echo ===> OwnChatBot Quickstart (Batch wrapper)
where docker >nul 2>&1 || (
  echo Docker is required. Install Docker Desktop first.
  exit /b 1
)

rem Prefer PowerShell script if available
where powershell >nul 2>&1 || where pwsh >nul 2>&1
if %ERRORLEVEL%==0 (
  echo Delegating to PowerShell script quickstart.ps1 ...
  powershell -ExecutionPolicy Bypass -File "%~dp0quickstart.ps1"
) else (
  echo PowerShell not found. Please run quickstart.sh on a Unix-like shell or install PowerShell.
  exit /b 1
)
