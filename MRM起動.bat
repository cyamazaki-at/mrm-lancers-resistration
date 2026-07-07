@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  MRM フリーランサー登録・管理システム
echo ============================================
echo.
echo  ランサー向け画面:  http://localhost:3000/
echo  社内管理画面:      http://localhost:3000/admin
echo.
echo  このウィンドウを閉じるとサーバーが停止します。
echo ============================================
start http://localhost:3000/admin
node server.js
pause
