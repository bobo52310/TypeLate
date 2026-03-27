# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2025-03-27

Initial public release.

### Added

- **Voice-to-text pipeline** — Press a hotkey, speak, release; transcribed text is pasted at the cursor in under 3 seconds
- **Hotkey trigger modes** — Hold, Toggle, and Double-Tap modes with configurable trigger key
- **Spoken-to-written enhancement** — AI removes filler words, restructures sentences, and corrects punctuation (Clean / Format / Custom modes)
- **Context-aware enhancement** — Automatically adjusts tone based on the active application (Email, Chat, Code Editor, Notes) and reads surrounding text near the cursor for additional AI context
- **Notch-style HUD overlay** — Transparent, always-on-top overlay displaying recording state, waveform visualization, transcription results, and active app icon
- **Dashboard** — Full application window with sidebar navigation for Settings, History, Dictionary, and Analytics
- **Smart Dictionary** — Custom vocabulary with batch import, AI auto-learning from post-paste corrections, and weight-based term ranking
- **Google Drive vocabulary sync** — Bidirectional sync via Google Drive `appDataFolder`, compatible with TypeLate Android
- **Recording management** — Configurable retention policy (Keep Forever / 30 / 14 / 7 days / Don't Keep), audio playback from history, re-transcribe with different settings
- **Sound feedback** — Five built-in sound themes (Default, Gentle, Minimal, Retro, Custom) with slot-based playback and custom sound file support
- **System audio mute** — Option to mute system audio during recording to prevent echo
- **History & analytics** — Full-text search, usage statistics, 30-day trend chart, cost tracking per model, daily free quota monitoring
- **JSON export** — Export transcription history as JSON
- **Keyboard shortcuts** — Cmd+, for settings, Cmd+1/2/3 for tab navigation, sidebar keyboard navigation
- **Onboarding wizard** — Step-by-step setup with API key configuration and hotkey selection
- **Auto-updater** — Built-in update mechanism via GitHub releases
- **Multi-language interface** — English, Japanese, Korean, Simplified Chinese, Traditional Chinese
- **Accessibility** — Skip-to-content link, reduced motion support, WCAG-compliant contrast
- **Hallucination detection** — Filters invalid speech based on no-speech probability and text anomalies
- **Circuit breaker** — Auto-disables Groq API calls on repeated failures to prevent cascading errors
- **Exponential backoff retry** — Automatic retry with backoff for transient API failures
- **Network connectivity pre-check** — Verifies network before attempting transcription
- **Recording safety timeout** — 5-minute maximum recording limit
- **Silence detection** — Shows hint in HUD when no speech is detected
- **Privacy-first design** — API key goes directly to Groq; voice data never passes through third-party servers; all data stored locally

### Performance

- Parallelized HUD bootstrap for faster startup
- Optimized waveform rendering with CSS custom properties

### Tests

- 127 unit tests covering core utilities: circuit breaker, sound presets, i18n completeness, enhancer, hallucination detector, platform detection, retry logic, surrounding text, keycode mapping, model registry, vocabulary batch parsing, context prompts, format utilities, app context mapping, API pricing
