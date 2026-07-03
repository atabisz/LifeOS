#Requires -Version 5.1
<#
  PAI Installer v5.0 — Windows Bootstrap (PowerShell)

  Native Windows entry point. Equivalent to install.sh but with no POSIX-shell
  dependency, for Windows users who don't have Git Bash. It does the same job:
  ensure Bun is available, then hand off to the same TypeScript wizard
  (PAI-Install/main.ts --mode cli). The cross-platform detection engine
  (engine/detect.ts) reports win32 and resolves tool paths via PATHEXT, so the
  wizard runs unmodified from here.

  Usage:   powershell -ExecutionPolicy Bypass -File install.ps1
  Requires: PowerShell 5.1+ (ships with Windows 10/11).
#>

$ErrorActionPreference = "Stop"

function Write-Info    { param($m) Write-Host "  i  $m" -ForegroundColor Cyan }
function Write-Ok      { param($m) Write-Host "  ok $m" -ForegroundColor Green }
function Write-Warn    { param($m) Write-Host "  !  $m" -ForegroundColor Yellow }
function Write-Err     { param($m) Write-Host "  x  $m" -ForegroundColor Red }

# ─── Resolve bundle dir (the directory this script lives in) ───────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  PAI | Personal AI Infrastructure — Windows installer (v5.0)" -ForegroundColor Blue
Write-Host ""
Write-Info "Platform: Windows ($($env:PROCESSOR_ARCHITECTURE))"

# ─── Locate the TypeScript installer ───────────────────────────────────────
# Canonical location mirrors install.sh: $ScriptDir/PAI/PAI-Install. Fallbacks
# cover a flattened layout where install.ps1 sits next to PAI-Install.
$InstallerDir = $null
foreach ($candidate in @(
    (Join-Path $ScriptDir "PAI\PAI-Install"),
    (Join-Path $ScriptDir "PAI-Install"),
    $ScriptDir
)) {
    if (Test-Path (Join-Path $candidate "main.ts")) { $InstallerDir = $candidate; break }
}
if (-not $InstallerDir) {
    Write-Err "Cannot find PAI-Install/main.ts. Expected at: $ScriptDir\PAI\PAI-Install\"
    exit 1
}

# ─── Ensure Bun ────────────────────────────────────────────────────────────
# Resolve bun.exe via PATH (Get-Command applies PATHEXT) or the default
# per-user install location. If absent, install it the official Windows way.
function Resolve-Bun {
    $cmd = Get-Command bun -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $default = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
    if (Test-Path $default) { return $default }
    return $null
}

$Bun = Resolve-Bun
if ($Bun) {
    Write-Ok "Bun found: $Bun"
} else {
    Write-Info "Installing Bun runtime..."
    # Official Windows installer. powershell -c "irm bun.sh/install.ps1 | iex"
    try {
        Invoke-RestMethod -Uri "https://bun.sh/install.ps1" | Invoke-Expression
    } catch {
        Write-Err "Failed to install Bun automatically: $($_.Exception.Message)"
        Write-Err "Install it manually from https://bun.sh and re-run this script."
        exit 1
    }
    # The installer adds bun to PATH for new sessions; pick it up for THIS one.
    $bunBin = Join-Path $env:USERPROFILE ".bun\bin"
    if (Test-Path $bunBin) { $env:PATH = "$bunBin;$env:PATH" }
    $Bun = Resolve-Bun
    if (-not $Bun) {
        Write-Err "Bun installed but bun.exe is still not resolvable. Open a new terminal and re-run."
        exit 1
    }
    Write-Ok "Bun installed: $Bun"
}

# ─── Check Claude Code (non-fatal — wizard can install it) ─────────────────
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Ok "Claude Code found"
} else {
    Write-Warn "Claude Code not found — the wizard will guide installation."
}

# ─── Launch the wizard ─────────────────────────────────────────────────────
# CLI mode only on Windows: the GUI path is Electron (main.ts), which is not
# bootstrapped here. PAI_BUNDLE_DIR lets the wizard install from these local
# files instead of git-cloning, matching install.sh.
$env:PAI_BUNDLE_DIR = $ScriptDir

Write-Host ""
Write-Info "Launching installer..."
Write-Host ""

& $Bun run (Join-Path $InstallerDir "main.ts") --mode cli
$ExitCode = $LASTEXITCODE

if ($ExitCode -eq 0) {
    Write-Host ""
    Write-Info "Install complete. To start pai, run:  cd `"$env:USERPROFILE\.claude`"; claude"
}
exit $ExitCode
