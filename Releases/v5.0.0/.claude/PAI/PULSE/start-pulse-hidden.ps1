# ============================================================
#  PAI Pulse - hidden / detached launcher (Life Dashboard + voice on :31337)
#
#  The Windows counterpart to start-pulse.sh. Launched at login by the
#  Startup-folder entry that install-pulse-autostart.ps1 creates, or directly:
#     powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden `
#                -File start-pulse-hidden.ps1
#
#  Why this exists: Windows has no launchd/systemd. Start-Process
#  -WindowStyle Hidden spawns bun with no console/taskbar window; this launcher
#  returns immediately so the bun process is orphaned and survives any terminal
#  closing. Idempotent: if :31337 already answers, it does nothing.
#
#  Portable by design - the Pulse directory is THIS script's own directory
#  ($PSScriptRoot), and bun is resolved from PATH first, so the file works for
#  any user without editing hardcoded paths.
#
#  ASCII-only on purpose: Windows PowerShell 5.1 reads a UTF-8 file with no BOM
#  as the ANSI codepage, which mangles multibyte characters and can break
#  parsing. Keep this file 7-bit ASCII so it parses at login everywhere.
# ============================================================

$ErrorActionPreference = 'Stop'

$pulseDir = $PSScriptRoot
$server   = Join-Path $pulseDir 'pulse.ts'
$log      = Join-Path $pulseDir 'pulse-server.log'
$errLog   = Join-Path $pulseDir 'pulse-server.log.err'
$stamp    = (Get-Date).ToString('s')

# Resolve bun: PATH first (Get-Command applies PATHEXT), then the default
# per-user install location. Never assume a hardcoded drive path.
$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) { $bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }

# Idempotence: if :31337 is already listening, do nothing. The running Pulse
# owns $log (stdout redirect), so guard the skip-path log write against the
# file lock - never crash the common every-login case.
$listening = Get-NetTCPConnection -LocalPort 31337 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Add-Content -Path $log -Value "[$stamp] pulse already listening on :31337 - skip" -ErrorAction SilentlyContinue
    exit 0
}

# Prerequisites must exist.
if (-not (Test-Path $bun)) {
    Add-Content -Path $errLog -Value "[$stamp] ERROR bun not found (PATH or $bun)"
    exit 1
}
if (-not (Test-Path $server)) {
    Add-Content -Path $errLog -Value "[$stamp] ERROR pulse.ts not found at $server"
    exit 1
}

Add-Content -Path $log -Value "[$stamp] starting pulse on :31337"

# Spawn bun hidden + detached, with the Pulse dir as the working directory so
# pulse.ts and PULSE.toml resolve relatively. This launcher returns immediately,
# orphaning the server so it outlives any terminal.
Start-Process -FilePath $bun `
    -ArgumentList 'run', $server `
    -WorkingDirectory $pulseDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $log `
    -RedirectStandardError  $errLog

exit 0
