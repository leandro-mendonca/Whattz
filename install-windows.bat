@echo off
REM ============================================================================
REM Instalador e Gerador Automatico — Whattz E360 (Windows)
REM ============================================================================
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================================
echo ⚡ Instalador Automatico — Whattz E360 (Marica / Enel RJ)
echo ================================================================

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [!] Node.js nao encontrado. Tentando instalar Node.js LTS via winget...
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
)

echo -^> Instalando dependencias do Electron...
call npm install

echo -^> Executando testes de validacao do calculo...
call npm test

echo -^> Gerando instalador Windows (.exe) na pasta dist\...
call npm run dist:win

echo ================================================================
echo ✅ Concluido! O instalador Windows (.exe) foi gerado na pasta "dist"
echo    Ou execute "npm start" para abrir o aplicativo imediatamente.
echo ================================================================
pause
