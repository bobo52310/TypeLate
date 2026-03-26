# TypeLate

> Press, speak, release -- your voice becomes text, right where you type.

TypeLate is a cross-platform desktop voice-to-text tool built with Tauri v2, React 19, and Rust. Hold a hotkey in any application, speak naturally, and release. Your speech is transcribed via Groq Whisper API, optionally enhanced by an LLM to convert spoken language into polished written text, and auto-pasted at the cursor position.

## Features

- **Global hotkey activation** -- Trigger voice input from any application with a configurable hotkey. Supports both hold-to-record and toggle modes.
- **Spoken-to-written conversion** -- AI automatically removes filler words, restructures sentences, and corrects punctuation so the result reads as clean written text.
- **Low latency** -- Powered by Groq's inference engine, end-to-end processing completes in under 3 seconds, including LLM enhancement.
- **Custom vocabulary dictionary** -- Teach TypeLate your proper nouns, technical terms, and jargon to improve transcription accuracy. Includes smart dictionary learning from transcription context.
- **History and analytics** -- All transcriptions are saved with full history search. A dashboard provides usage statistics and cost tracking.
- **Notch-style HUD overlay** -- A minimal, always-on-top overlay displays recording and transcription status without interrupting your workflow.
- **Multi-language support** -- Interface available in English, Japanese, Korean, Simplified Chinese, and Traditional Chinese.
- **Cross-platform** -- Runs on macOS (Apple Silicon and Intel) and Windows.

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

## License

[MIT](LICENSE)
