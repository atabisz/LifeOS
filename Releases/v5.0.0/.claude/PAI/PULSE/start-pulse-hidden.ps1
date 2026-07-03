# ============================================================
#  PAI Pulse - hidden / detached launcher (Life Dashboard + voice on :31337)
#
#  Launched at login by the Startup-folder shortcut:
#     powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden
#                    -File start-pulse-hidden.ps1
#
#  Why PowerShell and not the old start-pulse-hidden.vbs: on this Intune-managed
#  machine the GUI Windows Script Host (wscript) errors, mshta is blocked, and
#  schtasks is admin-denied. Start-Process -WindowStyle Hidden is the one
#  windowless, no-admin path that works here. The bun process it spawns is
#  orphaned (this launcher exits immediately), so closing any terminal cannot
#  kill it. Mirrors VoiceServer\start-voice-hidden.ps1, the proven pattern.
# ============================================================

$ErrorActionPreference = 'Stop'

$home_      = $env:USERPROFILE
$bun        = Join-Path $home_ '.bun\bin\bun.exe'
$pulseDir   = Join-Path $home_ '.claude\PAI\PULSE'
$server     = Join-Path $pulseDir 'pulse.ts'
$log        = Join-Path $pulseDir 'pulse-server.log'
$errLog     = Join-Path $pulseDir 'pulse-server.log.err'
$stamp      = (Get-Date).ToString('s')

# --- Idempotence: if :31337 is already listening, do nothing. ---
#     Best-effort log: the running Pulse owns $log (its stdout redirect), so a
#     skip-path Add-Content would hit a file lock — never let that crash the
#     skip path (it is the common case at every login after the first).
$listening = Get-NetTCPConnection -LocalPort 31337 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Add-Content -Path $log -Value "[$stamp] pulse already listening on :31337 - skip" -ErrorAction SilentlyContinue
    exit 0
}

# --- Prerequisites must exist. ---
if (-not (Test-Path $bun)) {
    Add-Content -Path $errLog -Value "[$stamp] ERROR bun not found at $bun"
    exit 1
}
if (-not (Test-Path $server)) {
    Add-Content -Path $errLog -Value "[$stamp] ERROR pulse.ts not found at $server"
    exit 1
}

Add-Content -Path $log -Value "[$stamp] starting pulse on :31337"

# --- Spawn bun hidden + detached, with pulse dir as the working directory so
#     pulse.ts and PULSE.toml resolve relatively. -WindowStyle Hidden gives no
#     console/taskbar window; this launcher returns immediately so the server
#     is orphaned and survives any terminal closing. ---
Start-Process -FilePath $bun `
    -ArgumentList 'run', $server `
    -WorkingDirectory $pulseDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $log `
    -RedirectStandardError  $errLog

exit 0
