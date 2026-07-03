# PAI Pulse — Windows MP3 playback helper
# Invoked by voice.ts on win32 with: powershell -File play-mp3.ps1 <path>
# Blocks until playback finishes, then exits.
param([Parameter(Mandatory=$true)][string]$Path)

$signature = @'
[DllImport("winmm.dll", CharSet=CharSet.Auto)]
public static extern int mciSendString(string command, System.Text.StringBuilder buffer, int bufferSize, System.IntPtr hwndCallback);
'@
$mci = Add-Type -MemberDefinition $signature -Name MCI -Namespace PAI -PassThru

$alias = "paivoice$([System.Diagnostics.Process]::GetCurrentProcess().Id)"
$mciPath = $Path -replace '\\', '/'

[void]$mci::mciSendString("open `"$mciPath`" type mpegvideo alias $alias", $null, 0, [System.IntPtr]::Zero)
[void]$mci::mciSendString("play $alias wait", $null, 0, [System.IntPtr]::Zero)
[void]$mci::mciSendString("close $alias", $null, 0, [System.IntPtr]::Zero)
