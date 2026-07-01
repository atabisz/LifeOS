' PAI Pulse — hidden Windows launcher
' Launches the voice server (pulse.ts) at login with NO visible console window.
'
' Why VBScript via wscript.exe: bun.exe is a console-subsystem binary, so any
' Run-key entry or shortcut that points straight at bun/cmd flashes a console
' window every login. wscript.exe is a GUI-subsystem host; WshShell.Run(cmd, 0, False)
' passes SW_HIDE (window style 0) into the child's STARTUPINFO, so bun's console is
' created already-hidden. No flash, ever.
'
' Invoked at login by the per-user Startup-folder entry PAI-Pulse.vbs.
' macOS users keep using manage.sh + com.pai.pulse.plist (launchd); this file is Windows-only.
'
' Longevity note: VBScript/WSH is deprecated on Windows 11 24H2+ (feature-on-demand,
' slated for eventual removal). If WSH is disabled or .vbs is re-associated away from
' wscript by policy, this launcher fails silently. If Pulse ever stops auto-starting
' after a Windows update, that is the first thing to check (see ISA Decisions 2026-06-04).

Option Explicit

Dim shell, fso, pulseDir, bunPath, cmd

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Absolute paths (no reliance on inherited PATH at login), resolved from the
' current user's profile so this works across machines regardless of username.
Dim userProfile
userProfile = shell.ExpandEnvironmentStrings("%USERPROFILE%")
pulseDir = userProfile & "\.claude\PAI\Pulse"
bunPath  = userProfile & "\.bun\bin\bun.exe"

' Bail quietly if prerequisites are missing — never pop an error dialog at login.
If Not fso.FileExists(bunPath) Then WScript.Quit 0
If Not fso.FileExists(pulseDir & "\pulse.ts") Then WScript.Quit 0

' HEALTH-BASED guard (not mere presence): if Pulse already answers on :31337, do nothing.
' This deliberately gates on the port responding, not on "a bun.exe exists" — a stale /
' half-dead bun process that crashed mid-bind would satisfy a presence check and leave us
' logged in to a dead port. So: probe health first; if unhealthy, reap any stale pulse.ts
' process (it may be holding the port) before launching fresh.
If PulseHealthy() Then WScript.Quit 0
KillStalePulse()

' Run from the Pulse directory so pulse.ts and PULSE.toml resolve relatively.
shell.CurrentDirectory = pulseDir

' Launch hidden (style 0), do not wait (False) — wscript exits immediately, Pulse keeps running.
cmd = """" & bunPath & """ run pulse.ts"
shell.Run cmd, 0, False

WScript.Quit 0


' --- helpers ---

' True if the voice endpoint answers within a short timeout. Any error => not healthy.
Function PulseHealthy()
  Dim http
  PulseHealthy = False
  On Error Resume Next
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  If Err.Number <> 0 Then On Error Goto 0 : Exit Function
  ' resolve, connect, send, receive timeouts (ms) — keep login fast.
  http.SetTimeouts 2000, 2000, 2000, 2000
  http.Open "POST", "http://localhost:31337/notify", False
  http.SetRequestHeader "Content-Type", "application/json"
  http.Send "{""message"":"""",""voice_enabled"":false}"
  If Err.Number = 0 Then
    If http.Status = 200 Then PulseHealthy = True
  End If
  On Error Goto 0
End Function

' Terminate any bun.exe whose command line runs pulse.ts (clears a stale port holder).
Sub KillStalePulse()
  Dim wmi, procs, p
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set procs = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'bun.exe'")
  For Each p In procs
    If Not IsNull(p.CommandLine) Then
      If InStr(LCase(p.CommandLine), "pulse.ts") > 0 Then p.Terminate()
    End If
  Next
  On Error Goto 0
End Sub
