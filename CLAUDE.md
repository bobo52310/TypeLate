# SayIt — Project Guide

> Tauri v2 + React 19 + Rust voice-to-text desktop application

## Dual-Window Architecture

```
 ┌─────────────────────────────────────────────────┐
 │                  Tauri Backend (Rust)            │
 │  lib.rs ─ plugins/ ─ audio_recorder.rs          │
 │                      transcription.rs            │
 │                      hotkey_listener.rs          │
 │                      clipboard_paste.rs          │
 │                      keyboard_monitor.rs         │
 │                      audio_control.rs            │
 │                      sound_feedback.rs           │
 │                      text_field_reader.rs        │
 │                                                  │
 │  ┌─── invoke() ──┐     ┌─── emit() ────┐        │
 │  │               │     │               │        │
 │  ▼               ▼     ▼               ▼        │
 │ ┌──────────┐  ┌──────────────────────────┐      │
 │ │   HUD    │  │      Dashboard           │      │
 │ │ index.   │  │   main-window.html       │      │
 │ │ html     │  │   DashboardApp + Router  │      │
 │ │ HudApp   │  │   4 views + Zustand      │      │
 │ │ NotchHud │  │   shadcn/ui              │      │
 │ └──────────┘  └──────────────────────────┘      │
 │  label:main    label:main-window                │
 │  400x100       960x680 (min 720x480)            │
 │  transparent   decorations, resizable           │
 │  alwaysOnTop   hidden on startup                │
 └─────────────────────────────────────────────────┘
```

## Dependency Direction Rules

```
  views/ ──→ components/ + stores/ + hooks/
  stores/ ──→ lib/
  lib/ ──→ External APIs (Groq)

  ❌ views/ must NOT import lib/ directly
  ❌ components must NOT execute SQL directly
```

## IPC Contracts

### Tauri Commands (Frontend → Rust)

| Command | Plugin | Purpose |
|---------|--------|---------|
| `debug_log` | lib.rs | Log to Rust console |
| `update_hotkey_config` | lib.rs | Update hotkey settings |
| `get_hud_target_position` | lib.rs | Get HUD screen position |
| `paste_text` | clipboard_paste | Write + simulate Ctrl/Cmd+V |
| `copy_to_clipboard` | clipboard_paste | Write to clipboard |
| `start_recording` | audio_recorder | Start mic capture |
| `stop_recording` | audio_recorder | Stop + return WAV buffer |
| `transcribe_audio` | transcription | Send WAV to Groq Whisper |
| `retranscribe_from_file` | transcription | Re-transcribe saved audio |
| `play_start_sound` / `play_stop_sound` / `play_error_sound` / `play_learned_sound` | sound_feedback | System sounds |
| `mute_system_audio` / `restore_system_audio` | audio_control | Mute during recording |
| `start_quality_monitor` / `start_correction_monitor` | keyboard_monitor | Post-paste monitoring |
| `read_focused_text_field` | text_field_reader | Read AX text field |
| `check_accessibility_permission_command` | hotkey_listener | macOS permission check |
| `list_audio_input_devices` | audio_recorder | Enumerate mic devices |

### Rust → Frontend Events

| Event | Payload | Source |
|-------|---------|--------|
| `hotkey:pressed` / `hotkey:released` / `hotkey:toggled` | `HotkeyEventPayload` | hotkey_listener |
| `hotkey:error` | `HotkeyErrorPayload` | hotkey_listener |
| `quality-monitor:result` | `QualityMonitorResultPayload` | keyboard_monitor |
| `correction-monitor:result` | `CorrectionMonitorResultPayload` | keyboard_monitor |
| `audio:waveform` | `WaveformPayload { levels: [f32; 6] }` | audio_recorder |

### Cross-Window Events (Frontend only)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `voice-flow:state-changed` | HUD → Dashboard | Sync recording status |
| `transcription:completed` | HUD → Dashboard | Notify new transcription |
| `settings:updated` | Dashboard → HUD | Sync settings changes |
| `vocabulary:changed` | Dashboard → HUD | Sync vocabulary changes |
| `vocabulary:learned` | HUD → HUD (NotchHud) | Show learned notification |

## Code Conventions

- **React**: Function components only, hooks for all state/effects
- **State**: Zustand stores (not React Context for global state)
- **UI**: shadcn/ui components (new-york style), never raw HTML form elements
- **Icons**: `lucide-react` only
- **CSS**: Tailwind CSS v4 semantic tokens (`bg-card`, `text-foreground`, `border-border`)
- **i18n**: `useTranslation()` hook, never hardcode user-facing strings
- **Tauri**: Frontend calls `invoke()` via stores, never directly from views
- **Events**: Use `useTauriEvent` hook in components, raw `listen()` in stores

## Type Naming

| Suffix | Usage | Example |
|--------|-------|---------|
| `*Payload` | Tauri event payload | `VoiceFlowStateChangedPayload` |
| `*Record` | SQLite row (camelCase) | `TranscriptionRecord` |
| `*Config` | Settings object | `HotkeyConfig` |
| `*Entry` | List item | `VocabularyEntry` |

## SQLite Rules

- Table names: plural snake_case (`transcriptions`)
- Columns: snake_case → TS camelCase via `mapRowToRecord()`
- Boolean: `INTEGER` → `row.was_enhanced === 1`
- Primary key: `TEXT` (UUID, `crypto.randomUUID()`)
- Parameters: `$1, $2` (tauri-plugin-sql)

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm tauri dev` | Development mode |
| `pnpm build` | Frontend build (tsc + vite) |
| `pnpm test` | Run Vitest |
| `pnpm lint` | ESLint check |
| `pnpm format` | Prettier format |
