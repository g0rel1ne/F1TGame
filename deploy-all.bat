@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo  F1 Team Principal - Supabase + GitHub deploy
echo ============================================================
echo.

where node.exe >nul 2>&1 || goto :missing_node
where npx.cmd >nul 2>&1 || goto :missing_node
where git.exe >nul 2>&1 || goto :missing_git

if not exist ".env.local" (
  echo [ERROR] .env.local was not found.
  echo Copy .env.example to .env.local and fill in VITE_SUPABASE_URL.
  goto :fail
)

set "SUPABASE_URL="
for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"VITE_SUPABASE_URL=" ".env.local"') do set "SUPABASE_URL=%%B"
set "SUPABASE_URL=%SUPABASE_URL:https://=%"
set "SUPABASE_URL=%SUPABASE_URL:http://=%"
for /f "tokens=1 delims=. " %%R in ("%SUPABASE_URL%") do set "SUPABASE_PROJECT_REF=%%R"

if "%SUPABASE_PROJECT_REF%"=="" (
  echo [ERROR] Could not read a Supabase project ref from VITE_SUPABASE_URL.
  goto :fail
)

echo Supabase project: %SUPABASE_PROJECT_REF%
echo Git remote:        origin/main
echo.

call npx.cmd --yes supabase projects list >nul 2>&1
if errorlevel 1 (
  echo Supabase CLI is not logged in. Opening login...
  call npx.cmd --yes supabase login || goto :fail
)

set "LINKED_REF="
if exist "supabase\.temp\project-ref" set /p LINKED_REF=<"supabase\.temp\project-ref"
if /i not "%LINKED_REF%"=="%SUPABASE_PROJECT_REF%" (
  echo Linking Supabase project...
  if defined SUPABASE_DB_PASSWORD (
    call npx.cmd --yes supabase link --project-ref "%SUPABASE_PROJECT_REF%" --password "%SUPABASE_DB_PASSWORD%" || goto :fail
  ) else (
    call npx.cmd --yes supabase link --project-ref "%SUPABASE_PROJECT_REF%" || goto :fail
  )
)

echo.
echo [1/6] Syncing engine and data into Edge Functions...
call node scripts\sync-engine.mjs || goto :fail

echo.
echo [2/6] Typechecking...
call npm.cmd run typecheck || goto :fail

echo.
echo [3/6] Running tests...
call npm.cmd test || goto :fail

echo.
echo [4/6] Building the frontend...
call npm.cmd run build || goto :fail

echo.
echo [5/6] Pushing database migrations...
call npx.cmd --yes supabase db push || goto :fail

echo.
echo [6/6] Deploying Edge Functions...
for %%F in (apply-action start-race set-ready negotiate transfer-host remove-member commit-live-race) do (
  echo   - %%F
  call npx.cmd --yes supabase functions deploy %%F --project-ref "%SUPABASE_PROJECT_REF%" || goto :fail
)

echo.
echo Committing and pushing to GitHub...
git add -A || goto :fail

rem Keep unrelated local work out of the deployment commit.
git reset -- roblox tmp-dump src/data/drivers.ts src/data/staff.ts scripts/_dump.mjs scripts/_genluau.mjs tsconfig.app.tsbuildinfo >nul 2>&1

git diff --cached --quiet
if errorlevel 1 (
  git commit -m "chore: deploy live race realism update" || goto :fail
) else (
  echo No deployment changes to commit.
)

git push origin main || goto :fail

echo.
echo ============================================================
echo  Deploy complete.
echo  GitHub Actions will publish the frontend automatically:
echo  https://github.com/g0rel1ne/F1TGame/actions
echo ============================================================
exit /b 0

:missing_node
echo [ERROR] Node.js and npx are required. Install Node.js 20+ and retry.
goto :fail

:missing_git
echo [ERROR] Git is required. Install Git and retry.
goto :fail

:fail
echo.
echo [FAILED] Deploy stopped. Check the error above.
exit /b 1
