# LifeOS Installer v6.0

> Install [PAI (Personal AI Infrastructure)](https://github.com/danielmiessler/PAI) with a single command.

## Quick Start

```bash
bash PAI_INSTALL/install.sh
```

That's it. The script handles everything:

1. Detects your operating system and installed tools
2. Installs **Bun** and **Git** if missing
3. Launches a guided Web UI installer
4. Walks you through identity, voice, and configuration
5. Validates the installation before finishing

### Requirements

- **bash** and **curl** — that's all you need to start
- macOS or Linux
- Internet connection

Everything else (Bun, Git, Claude Code) is installed automatically.

---

## Installation Steps

The installer runs 9 steps in dependency order:

| # | Step | What It Does |
|---|------|-------------|
| 1 | **System Detection** | Detects OS, architecture, shell, installed tools (Bun, Git, Claude Code), timezone, and any existing LifeOS installation |
| 2 | **Prerequisites** | Installs missing tools: Git via Xcode CLT or package manager, Bun via official installer, Claude Code via npm |
| 3 | **API Keys** | Auto-completes — key collection happens during the Voice step |
| 4 | **Identity** | Prompts for your name, AI assistant name, timezone, and a personal catchphrase |
| 5 | **LifeOS Repository** | Clones the LifeOS repo to `~/.claude/` (or updates if already present), then relocates `PAI/USER/` to `~/.config/PAI/USER/` and replaces the live-tree path with a symlink so system code and user data live in separate trees |
| 6 | **Configuration** | Generates `settings.json`, writes the canonical `~/.config/PAI/.env`, sets up the `pai` shell alias, and patches version files. Prints the system/data separation rule and the optional "turn `~/.config/LIFEOS` into a private git repo" recommendation |
| 7 | **DA Voice + Pulse** | Collects ElevenLabs API key, selects voice type (Female/Male/Custom), prompts to install Pulse (voice + Life Dashboard + observability on port 31337) and the Pulse menu bar app via launchd |
| 8 | **Telegram Bot (optional)** | Optional — wires a Telegram bot so Pulse can chat with you and send notifications |
| 9 | **Validation** | Verifies directory structure, settings file, API keys, Pulse health on 31337, launchd plist, shell alias — reports pass/fail for each |

### Voice + Pulse Setup

The voice step handles Digital Assistant voice configuration **and** Pulse install in one cohesive step:

1. Collects or auto-discovers your ElevenLabs API key (checks `~/.config/PAI/.env`)
2. Validates the key against the ElevenLabs API
3. **Asks (Y/n) to install Pulse** as a launchd service — Pulse is the unified LifeOS runtime that serves the Life Dashboard at `http://localhost:31337`, handles voice notifications (TTS via ElevenLabs), and runs observability + scheduled jobs. Installing as a launchd agent makes it auto-start on login.
4. Presents voice selection: **Female** (Rachel), **Male** (Adam), or **Custom Voice ID** with audio previews
5. **Asks (Y/n) to install the Pulse menu bar app** — adds a status icon to your macOS menu bar, second launchd plist, auto-starts on login
6. Tests TTS via Pulse with a personalized greeting using your name and AI name

Since LifeOS 5.0 the standalone voice server has been absorbed into Pulse: there is no separate process — Pulse on port 31337 embeds the voice module, the Life Dashboard, observability, and scheduled jobs in one launchd-managed runtime.

Voice + Pulse are optional. Skip the ElevenLabs key and the installer continues without voice. Skip the Pulse install and you can run it later: `bash ~/.claude/PAI/PULSE/manage.sh install`.

### Graceful Degradation

The installer is designed to recover from partial failures:

- No ElevenLabs key → voice features skipped, Pulse can still install for dashboard + observability
- No existing LifeOS → fresh install (vs. upgrade if detected)
- Pulse install declined or fails → configuration saved, voice notifications unavailable until Pulse is installed manually
- Menu bar install declined or fails → Pulse keeps running; menu bar can be installed later
- Claude Code not installed → attempts installation, continues if it fails
- Port conflicts → installer port configurable via `PAI_INSTALL_PORT` environment variable

---

## Architecture

### Two-Layer Design

1. **Bootstrap** (`install.sh`) — Pure bash. Only needs bash + curl. Installs Bun and Git, then hands off to the TypeScript installer.
2. **Engine + UI** (`engine/` + `web/` + `public/`) — TypeScript (Bun). All install logic, web server, and frontend.

### Launch Modes

The installer supports three modes via `main.ts`:

| Mode | Command | Description |
|------|---------|-------------|
| **GUI** (default) | `--mode gui` | Launches Electron window wrapping the web server. Audio autoplay works. This is what `install.sh` uses. |
| **Web** | `--mode web` | Starts the Bun HTTP/WebSocket server on port 1337. Open in any browser. |
| **CLI** | `--mode cli` | Terminal-only wizard with ANSI colors and progress bars. No browser needed. |

GUI mode auto-installs Electron dependencies on first run and clears macOS quarantine flags.

### Directory Structure

```
PAI_INSTALL/
├── install.sh              # Bash bootstrap entry point
├── main.ts                 # Mode router (gui/web/cli)
├── generate-welcome.ts     # Welcome audio generator (build-time)
│
├── engine/                 # Core install logic (shared across all modes)
│   ├── types.ts            # TypeScript interfaces (InstallState, messages, events)
│   ├── detect.ts           # System detection (OS, tools, existing install)
│   ├── steps.ts            # Step definitions + dependency graph
│   ├── actions.ts          # Install action functions (clone, configure, voice, etc.)
│   ├── config-gen.ts       # Fallback settings.json generator
│   ├── validate.ts         # Post-install validation checks
│   ├── state.ts            # State persistence (resume interrupted installs)
│   └── index.ts            # Re-exports
│
├── web/                    # Web server (GUI and Web modes)
│   ├── server.ts           # Bun HTTP + WebSocket server (port 1337)
│   └── routes.ts           # WebSocket message handler + install orchestrator
│
├── cli/                    # CLI frontend
│   ├── index.ts            # CLI entry point
│   └── display.ts          # ANSI colors, progress bars, banners
│
├── public/                 # Static web assets
│   ├── index.html          # Single-page application shell
│   ├── styles.css          # Dark theme with glassmorphic effects
│   ├── app.js              # Frontend JavaScript (WebSocket client, UI rendering)
│   └── assets/             # Logos, fonts, welcome audio, voice previews
│
├── electron/               # Electron native wrapper
│   ├── main.js             # Spawns Bun server + opens BrowserWindow
│   └── package.json        # Electron dependency
│
└── README.md               # This file
```

---

## WebSocket Protocol

The Web UI communicates with the install engine over WebSocket. The server runs on `ws://localhost:1337/ws`.

### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `client_ready` | — | Client connected and ready |
| `start_install` | — | User clicked "Begin Installation" |
| `user_input` | `{ requestId, value }` | Response to a text/password input prompt |
| `user_choice` | `{ requestId, value }` | Response to a multiple-choice prompt |

### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `connected` | — | Connection acknowledged |
| `step_update` | `{ step, status }` | Step status changed (pending/active/completed/skipped/failed) |
| `detection_result` | `{ data }` | System detection results (OS, tools, existing install) |
| `message` | `{ role, content, speak? }` | Chat message (assistant/system/error) |
| `input_request` | `{ id, prompt, inputType, placeholder }` | Request text/password input from user |
| `choice_request` | `{ id, prompt, choices[] }` | Request selection from options |
| `progress` | `{ step, percent, detail }` | Progress bar update for long operations |
| `validation_result` | `{ checks[] }` | Array of validation check results |
| `install_complete` | `{ summary }` | Installation finished with summary data |
| `error` | `{ message }` | Error message |

Messages include a `replayed` flag for reconnect replay — replayed messages skip animations and TTS.

### Message Flow Example

```
Client                          Server
  │                               │
  ├── client_ready ──────────────→│
  │←─────────────── connected ────┤
  │                               │
  ├── start_install ─────────────→│
  │←──────────── step_update ─────┤  (system-detect → active)
  │←──────── detection_result ────┤  (OS, tools, etc.)
  │←──────────── step_update ─────┤  (system-detect → completed)
  │                               │
  │←──────── input_request ───────┤  ("What is your name?")
  ├── user_input ────────────────→│
  │←──────────── message ─────────┤  ("Welcome, {{PRINCIPAL_NAME}}!")
  │                               │
  │←──────── choice_request ──────┤  ("Select voice type")
  ├── user_choice ───────────────→│
  │←──────────── progress ────────┤  (voice server install: 40%)
  │←──────────── step_update ─────┤  (voice → completed)
  │                               │
  │←──── validation_result ───────┤  (all checks)
  │←──── install_complete ────────┤  (summary card)
```

---

## Configuration

### Settings Merge Strategy

LifeOS ships a complete `settings.json` template in the release repository. This template includes:

- **Hooks** — 20+ event hooks for session management, security, voice, etc.
- **Status line** — Terminal status bar configuration
- **Spinner verbs** — Activity indicator messages
- **Context files** — Files loaded into Claude Code context

The installer **does NOT generate hooks or status line config**. Instead, it:

1. Clones the LifeOS repository (which includes the full `settings.json` template)
2. Merges only user-specific fields into the existing template:
   - `principal` — user name, timezone
   - `daidentity` — AI name, voice ID, personality
   - `env` — PAI_DIR, PROJECTS_DIR
   - `pai` — version info
3. Preserves all hooks, status line, spinner verbs, and context files from the template

This ensures fresh installs get the full LifeOS configuration without the installer needing to know about every hook.

### Generated Files

| File | Location | Contents |
|------|----------|----------|
| `settings.json` | `~/.claude/settings.json` | Merged config (template + user fields) |
| `.env` | `~/.config/PAI/.env` (canonical) | `ELEVENLABS_API_KEY=...` — symlinked from `~/.claude/.env` and `~/.env` |
| `LATEST` | `~/.claude/PAI/ALGORITHM/LATEST` | Algorithm version (patched to current — uppercase `ALGORITHM` is case-sensitive on Linux) |
| Shell alias | `~/.zshrc` | `alias pai='cd ~/.claude && claude'` |

### Directory Structure Created

LifeOS 6.0 separates system code from user data across two directories. Code lives under `~/.claude/`; private user data lives under `~/.config/PAI/`. The wizard creates the symlink `~/.claude/PAI/USER → ~/.config/PAI/USER` so Claude Code's `@`-import resolver can reach identity / TELOS / config files at session start without crossing the zone boundary.

```
~/.claude/                     # SYSTEM tree — code, hooks, skills
├── settings.json
├── hooks/
├── skills/
├── PAI/
│   ├── ALGORITHM/
│   │   └── LATEST             # Algorithm doctrine version
│   ├── DOCUMENTATION/
│   ├── MEMORY/                # work history (root for the symlink in Phase G.2)
│   │   ├── WORK/
│   │   ├── STATE/
│   │   ├── LEARNING/
│   │   └── VOICE/
│   ├── PULSE/
│   ├── TOOLS/
│   └── USER → ~/.config/PAI/USER   # SYMLINK to user data tree (required)
├── Plans/
└── tasks/

~/.config/PAI/                 # USER tree — your private data
├── .env                       # ELEVENLABS_API_KEY etc. (canonical)
└── USER/                      # identity, TELOS, projects, integrations
    ├── PRINCIPAL/
    ├── DIGITAL_ASSISTANT/
    ├── TELOS/
    ├── PROJECTS.md
    └── ...
```

The separation is **required** for LifeOS to work. Don't delete the `~/.claude/PAI/USER` symlink. **Optional but recommended:** turn `~/.config/PAI/` into a private git repo so you have versioned history of your TELOS, identity, projects, and integrations:

```bash
cd ~/.config/LIFEOS
git init && git add -A && git commit -m "initial"
# Optional private remote:
gh repo create pai-user-data --private --source=. --push
```

### Banner and Counts

On first launch after installation, the LifeOS banner displays system statistics (skills, hooks, workflows, signals, files). These counts are:

1. **Calculated by the installer** during the Configuration step (initial values)
2. **Updated by the StopOrchestrator hook** at the end of each Claude Code session

The Algorithm version displayed in the banner reads from `PAI/ALGORITHM/LATEST`.

---

## Web UI Features

- **Electron wrapper** — Opens in a controlled 1280x820 window with audio autoplay enabled
- **Dark theme** — Deep navy/black with LifeOS blue accents and glassmorphic card effects
- **Step sidebar** — All 9 steps with live status indicators (pending/active/completed/skipped/failed)
- **Progress bar** — Header shows overall completion percentage
- **Voice previews** — Listen to Female/Male voice samples before selecting
- **Welcome audio** — Pre-recorded MP3 plays on launch
- **Auto-reconnect** — WebSocket reconnects on disconnect with 2-second retry and full message replay
- **Input masking** — API keys are masked in the chat display (shows first 8 chars only)
- **Choice buttons** — Styled selection cards with descriptions and optional audio previews

---

## Post-Installation

After the installer completes, open a terminal and run:

```bash
source ~/.zshrc && pai
```

This reloads your shell config (activates the `pai` alias) and launches LifeOS for the first time.

### First-run: populate your personal context

Once LifeOS is running, kick off the phased interview to populate your TELOS, identity, preferences, and life dimensions:

```
/interview
```

The interview is conversational and resumable. It runs in 4 phases:

1. **Phase 1 — Foundational TELOS:** Mission, Goals, Problems, Strategies, Challenges, Narratives, Beliefs, Wisdom, Models, Frames
2. **Phase 2 — IDEAL_STATE:** Health, Money, Freedom, Relationships, Creative
3. **Phase 3 — Preferences:** Books, Authors, Bands, Movies, Restaurants, Food, Learning, Civic
4. **Phase 4 — Identity:** Light review of PRINCIPAL_IDENTITY and current state

Each section is skippable. If you have existing data (Obsidian, Notion, journals, prior LifeOS install), bring it in via the `Migrate` skill **before** running `/interview` — it intakes external content, classifies chunks against the LifeOS taxonomy, and writes them into the right files with provenance, so the interview only fills the genuine gaps.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `bun: command not found` | Run `curl -fsSL https://bun.sh/install \| bash` then restart terminal |
| Port 1337 in use | Set `PAI_INSTALL_PORT=8080` before running install.sh |
| ElevenLabs key invalid | Verify at elevenlabs.io — ensure no trailing spaces, key starts with `xi-` or `sk_` |
| Permission denied | Run `chmod -R 755 ~/.claude` |
| `pai` command not found | Run `source ~/.zshrc` to reload shell config |
| Pulse / voice notifications not working | Check port 31337 is free: `lsof -ti:31337`. Restart Pulse: `bash ~/.claude/PAI/PULSE/manage.sh restart`. Check status: `bash ~/.claude/PAI/PULSE/manage.sh status`. |
| Pulse menu bar icon missing | Install or reinstall: `bash ~/.claude/PAI/PULSE/MenuBar/install.sh`. Verify launchd plist: `ls ~/Library/LaunchAgents/com.lifeos.pulse-menubar.plist`. |
| Banner shows wrong algorithm version | Check `~/.claude/PAI/ALGORITHM/LATEST` contains correct version |
| Banner counts all show 0 | Normal on first launch — counts populate after your first Claude Code session ends |
| WebSocket "Connection lost" | The installer auto-reconnects. If persistent, check if another process is using port 1337 |
| Electron window blank | Try `--mode web` instead and open `http://localhost:1337` in your browser |

### Recovery

The installer saves state to disk. If interrupted, re-run `install.sh` — it will detect the existing installation and offer to resume or start fresh.

---

## Development

### Running Locally

```bash
# Web mode (development)
bun run PAI_INSTALL/main.ts --mode web

# CLI mode
bun run PAI_INSTALL/main.ts --mode cli

# GUI mode (Electron — installs deps on first run)
bun run PAI_INSTALL/main.ts --mode gui
```

### Key Design Decisions

- **No framework dependencies** — Frontend is vanilla JavaScript. No React, no build step.
- **Bun-native server** — Uses `Bun.serve()` for HTTP and WebSocket in one process.
- **Async Pulse install** — Pulse install via `manage.sh install` uses async `spawn` (not `execSync`) to avoid blocking the event loop and killing WebSocket connections. Since LifeOS 5.0, the standalone voice server has been absorbed into Pulse on port 31337 — there is no separate voice-server process.
- **Safe process cleanup** — Port cleanup uses `lsof -sTCP:LISTEN` to kill only the listening process, not client connections.
- **Template-based settings** — Installer merges user fields into the release template rather than generating a complete settings.json from scratch.

---

## Known Limitations

- **macOS and Linux only** — Windows is not supported
- **Internet connection required** — Downloads tools, clones repository, validates API keys
- **Voice requires ElevenLabs** — Voice synthesis is optional but needs an ElevenLabs API key
- **Single-user** — Installs to `~/.claude/` (system) and `~/.config/PAI/` (user data) for the current user only
- **Electron optional** — If Electron fails to install, use `--mode web` as fallback

## License

Part of [PAI — Personal AI Infrastructure](https://github.com/danielmiessler/PAI).
