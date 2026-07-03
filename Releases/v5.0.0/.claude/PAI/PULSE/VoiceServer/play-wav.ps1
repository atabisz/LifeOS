# PAI Pulse — Windows WAV playback helper
# Invoked by voice.ts on win32 with: powershell -File play-wav.ps1 -Path <path>
# Uses System.Media.SoundPlayer.PlaySync — blocks until playback finishes, then exits.
param([Parameter(Mandatory=$true)][string]$Path)

(New-Object System.Media.SoundPlayer $Path).PlaySync()
