[繁體中文](README_zh-TW.md) | **English**

<div align="center">
  <img src="src-tauri/icons/icon.png" width="120" alt="TypeLate Logo" />

  # TypeLate

  **Press, speak, release — your voice becomes text, right where you type.**

  [![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![GitHub Release](https://img.shields.io/github/v/release/bobo52310/TypeLate)](https://github.com/bobo52310/TypeLate/releases/latest)

  <img src="screenshots/desktop-viewport.png" width="700" alt="TypeLate Dashboard" />
</div>

> Android version is also open source: [TypeLate-android](https://github.com/bobo52310/TypeLate-android) — same Groq Whisper transcription, LLM enhancement, and vocabulary sync, built with Kotlin + Jetpack Compose.

## Features

### Use anywhere

Trigger voice input from any application with a configurable global hotkey. Supports **hold-to-record**, **toggle**, and **double-click** trigger modes.

### Spoken-to-written conversion

AI automatically removes filler words, restructures sentences, and corrects punctuation. Three enhancement modes:
- **Clean** — Fix errors only, preserve your original tone
- **Format** — Restructure into paragraphs, lists, or structured text
- **Custom** — Write your own prompt for full control over output

### Under 3 seconds

End-to-end processing powered by Groq — currently the fastest inference engine. Speech transcription plus LLM enhancement completes in under 3 seconds.

### Context-aware enhancement

Automatically adjusts tone based on the active application:
- **Email** (Mail, Outlook) — formal and professional
- **Chat** (Slack, Discord, Teams) — casual and concise
- **Code Editor** (VS Code, Xcode, Terminal) — technically precise
- **Notes** (Obsidian, Notion, Bear) — natural writing

Also reads surrounding text near the cursor so the AI produces more coherent output.

### Smart dictionary

- **Custom vocabulary** — Teach TypeLate your proper nouns, technical terms, and jargon to improve transcription accuracy. Supports batch import.
- **Auto-learning** — When the AI detects you corrected transcribed text after pasting, it automatically learns the correct terms.
- **Google Drive sync** — Two-way sync keeps vocabulary consistent across devices.

### Recording management

- Configurable retention policy: keep forever, 30 / 14 / 7 days, or don't keep
- Play back past recordings directly from history
- Re-transcribe existing audio with different settings

### Sound feedback

Five built-in sound themes (Default, Gentle, Minimal, Retro, Custom) with support for custom sound files. Can auto-mute system audio during recording to prevent echo.

### History and analytics

All transcriptions are saved automatically with full-text search. The dashboard provides:
- Usage statistics (total recording time, total characters, transcription count)
- 30-day usage trend chart
- Per-model cost tracking
- Daily free quota monitoring

### Notch-style HUD overlay

A minimal, always-on-top overlay displays recording status, waveform, and transcription results without interrupting your workflow. Shows the current application's icon during recording.

### Multi-language support

Interface available in English, Japanese, Korean, Simplified Chinese, and Traditional Chinese.

### Privacy-first

Your API key goes directly to Groq — voice data never passes through our servers. All transcriptions and recordings are stored locally on your device.

### Cross-platform

Runs on macOS (Apple Silicon and Intel) and Windows.

## Download

| Platform              | Link                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | [TypeLate-mac-arm64.dmg](https://github.com/bobo52310/TypeLate/releases/latest/download/TypeLate-mac-arm64.dmg)     |
| macOS (Intel)         | [TypeLate-mac-x64.dmg](https://github.com/bobo52310/TypeLate/releases/latest/download/TypeLate-mac-x64.dmg)         |
| Windows               | [TypeLate-windows-x64.exe](https://github.com/bobo52310/TypeLate/releases/latest/download/TypeLate-windows-x64.exe) |

## Quick Start

1. Download and install TypeLate for your platform.
2. Open TypeLate.
3. Go to Settings and enter your [Groq API key](https://console.groq.com/keys) (free to obtain).
4. In any application, press and hold the `Fn` key (default), speak, then release. Your transcribed text is automatically pasted at the cursor.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) 1.77+ (stable)
- [pnpm](https://pnpm.io/) 10+
- Xcode Command Line Tools (macOS only)

### Setup

```bash
git clone https://github.com/bobo52310/TypeLate.git
cd TypeLate
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm build          # TypeScript compilation + Vite build
pnpm tauri build    # Full native application build
```

### Test

```bash
pnpm test             # Run all tests
pnpm test:watch       # Run tests in watch mode
pnpm test:coverage    # Run tests with coverage report
```

### Lint and Format

```bash
pnpm lint       # Run ESLint
pnpm format     # Run Prettier
```

## Architecture

TypeLate uses a dual-window architecture:

```
+--------------------------------------------------+
|              Tauri Backend (Rust)                 |
|  Global hotkey - Clipboard - Audio control       |
|  Audio recording - Transcription - Sound FX      |
|                                                  |
|  +--- invoke() ---+     +--- emit() ----+        |
|  |                |     |               |        |
|  v                v     v               v        |
| +----------+  +----------------------------+     |
| |   HUD    |  |        Dashboard           |     |
| | Overlay  |  | Settings / History /       |     |
| | 400x100  |  | Dictionary / Analytics     |     |
| | floating |  | 960x680                    |     |
| +----------+  +----------------------------+     |
|  label:main    label:main-window                 |
+--------------------------------------------------+
```

- **HUD window** -- A small, transparent, always-on-top overlay (notch-style) that displays the current voice flow state: idle, recording, transcribing, or result.
- **Dashboard window** -- The main application window with settings, transcription history, vocabulary dictionary, and usage analytics.

Communication between the Rust backend and React frontend uses Tauri's IPC system: `invoke()` for frontend-to-backend commands, and `emit()` for backend-to-frontend events.

## Tech Stack

| Layer                | Technology                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Desktop framework    | [Tauri v2](https://v2.tauri.app/) (Rust backend)                                             |
| Frontend             | [React 19](https://react.dev/) + TypeScript                                                  |
| State management     | [Zustand 5](https://zustand.docs.pmnd.rs/)                                                   |
| Routing              | [TanStack Router](https://tanstack.com/router)                                               |
| UI components        | [shadcn/ui](https://ui.shadcn.com/) (New York style) + [Radix UI](https://www.radix-ui.com/) |
| Styling              | [Tailwind CSS v4](https://tailwindcss.com/)                                                  |
| Icons                | [Lucide React](https://lucide.dev/)                                                          |
| Charts               | [Recharts](https://recharts.org/)                                                            |
| Database             | SQLite via [tauri-plugin-sql](https://v2.tauri.app/plugin/sql/)                              |
| Settings storage     | [tauri-plugin-store](https://v2.tauri.app/plugin/store/)                                     |
| AI / Speech          | [Groq API](https://groq.com/) (Whisper for STT, LLM for text enhancement)                    |
| Internationalization | [i18next](https://www.i18next.com/) + [react-i18next](https://react.i18next.com/)            |
| Error tracking       | [Sentry](https://sentry.io/)                                                                 |
| Testing              | [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/)              |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines, code conventions, and how to submit changes.

## Security

See [SECURITY.md](SECURITY.md) for reporting security vulnerabilities.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE)
