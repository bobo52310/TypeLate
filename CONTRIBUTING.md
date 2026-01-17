# Contributing to TypeLate

Thank you for your interest in contributing to TypeLate. This guide covers the development environment, project conventions, and submission process.

## Table of Contents

- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Code Conventions](#code-conventions)
- [Testing Guidelines](#testing-guidelines)
- [Translation Guide](#translation-guide)
- [Pull Request Process](#pull-request-process)

## Development Environment

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) 1.77+ (stable toolchain)
- [pnpm](https://pnpm.io/) 10+
- Xcode Command Line Tools (macOS only): `xcode-select --install`

### Setup

```bash
git clone https://github.com/bobo52310/TypeLate.git
cd TypeLate
pnpm install
pnpm tauri dev
```

This starts both the Vite dev server (frontend) and the Tauri Rust backend. The application will open with hot-reload enabled for the frontend.

### Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm tauri dev` | Start the app in development mode |
| `pnpm build` | TypeScript check + Vite production build |
| `pnpm tauri build` | Full native application build |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Run Prettier |

## Project Structure

```
TypeLate/
+-- src/                        # React frontend source
|   +-- app/                    # Application entry points and router
|   |   +-- DashboardApp.tsx    # Dashboard window root component
|   |   +-- HudApp.tsx          # HUD window root component
|   |   +-- router.tsx          # TanStack Router configuration
|   +-- components/             # Reusable React components
|   |   +-- ui/                 # shadcn/ui components (generated)
|   |   +-- NotchHud.tsx        # HUD overlay component
|   |   +-- AccessibilityGuide.tsx
|   +-- hooks/                  # Custom React hooks
|   |   +-- useTauriEvent.ts    # Tauri event listener hook
|   |   +-- useAudioWaveform.ts # Audio visualization hook
|   |   +-- useFeedbackMessage.ts
|   +-- stores/                 # Zustand state stores
|   |   +-- settingsStore.ts    # Application settings
|   |   +-- historyStore.ts     # Transcription history
|   |   +-- vocabularyStore.ts  # Custom vocabulary
|   |   +-- voiceFlowStore.ts   # Voice recording state machine
|   |   +-- voiceFlow/          # Voice flow sub-modules
|   +-- views/                  # Page-level components (routes)
|   |   +-- HistoryView.tsx
|   |   +-- DictionaryView.tsx
|   |   +-- DashboardView.tsx
|   |   +-- SettingsView.tsx
|   |   +-- settings/           # Settings sub-sections
|   +-- lib/                    # Utility functions and services
|   |   +-- database.ts         # SQLite database operations
|   |   +-- enhancer.ts         # LLM text enhancement
|   |   +-- modelRegistry.ts   # AI model configuration
|   |   +-- migrations/         # Database migration files
|   +-- i18n/                   # Internationalization
|   |   +-- locales/            # Translation files (en, ja, ko, zh-TW)
|   |   +-- prompts.ts          # LLM prompt templates
|   +-- types/                  # TypeScript type definitions
|   +-- assets/                 # Static assets
|   +-- style.css               # Global styles and Tailwind config
|   +-- main.tsx                # HUD window entry point
|   +-- main-window.tsx         # Dashboard window entry point
+-- src-tauri/                  # Rust backend source
|   +-- src/
|   |   +-- lib.rs              # Main Tauri application setup
|   |   +-- main.rs             # Entry point
|   |   +-- plugins/            # Tauri plugin modules
|   |       +-- audio_recorder.rs
|   |       +-- audio_control.rs
|   |       +-- clipboard_paste.rs
|   |       +-- hotkey_listener.rs
|   |       +-- keyboard_monitor.rs
|   |       +-- sound_feedback.rs
|   |       +-- text_field_reader.rs
|   |       +-- transcription.rs
|   +-- tauri.conf.json         # Tauri configuration
|   +-- Cargo.toml              # Rust dependencies
+-- tests/                      # Test files
+-- index.html                  # HUD window HTML
+-- main-window.html            # Dashboard window HTML
```

### Dependency Flow

The project enforces a strict dependency direction:

```
views/ --> components/ + stores/ + hooks/
stores/ --> lib/
lib/ --> External APIs (Groq, Tauri plugins)
```

Rules:
- **Views must not import from `lib/` directly.** All data access and side effects go through Zustand stores.
- **Components must not execute SQL queries directly.** Use store actions instead.
- **Do not call Tauri event APIs directly.** Use the `useTauriEvent` hook from `hooks/useTauriEvent.ts`.
- **Do not use the browser's native `fetch`.** Use the `fetch` from `@tauri-apps/plugin-http` instead.

## Code Conventions

### React and TypeScript

- Use **functional components** exclusively. No class components.
- Use **React hooks** for all state and side effects.
- Prefer **named exports** over default exports.
- Use TypeScript strict mode. Avoid `any` types.
- Follow the existing naming conventions:
  - Components: `PascalCase.tsx`
  - Hooks: `useCamelCase.ts`
  - Stores: `camelCaseStore.ts`
  - Utilities: `camelCase.ts`

### Zustand Store Patterns

Stores are the primary layer for business logic. Follow the existing patterns:

```typescript
// Define the store interface
interface MyStore {
  // State
  items: Item[];
  isLoading: boolean;

  // Actions
  loadItems: () => Promise<void>;
  addItem: (item: Item) => void;
}

// Create the store
export const useMyStore = create<MyStore>()((set, get) => ({
  items: [],
  isLoading: false,

  loadItems: async () => {
    set({ isLoading: true });
    const items = await fetchItems();
    set({ items, isLoading: false });
  },

  addItem: (item) => {
    set((state) => ({ items: [...state.items, item] }));
  },
}));
```

### shadcn/ui Usage

TypeLate uses [shadcn/ui](https://ui.shadcn.com/) (New York style) for UI components. These components live in `src/components/ui/`.

Rules:
- **Use shadcn/ui components instead of raw HTML elements.** For example, use `<Button>` instead of `<button>`, `<Input>` instead of `<input>`.
- **Use component variants** via props rather than overriding styles. For example, `variant="destructive"` instead of `className="text-destructive"`.
- **Do not hand-write UI components** that shadcn/ui already provides (buttons, inputs, selects, switches, tables, dialogs, etc.).
- To add a new shadcn/ui component: `npx shadcn@latest add <component-name>`.

### Tailwind CSS

- **Use semantic color variables** defined in the theme: `bg-primary`, `text-foreground`, `border-border`, `bg-card`, `bg-muted`, etc.
- **Do not use raw Tailwind color values** like `bg-zinc-900`, `text-white`, or `border-gray-700`. Use the semantic equivalents.
- The project uses Tailwind CSS v4. Configuration is in `src/style.css`.

### Icons

- Use [Lucide React](https://lucide.dev/) for all icons.
- Do not introduce other icon libraries.

### Type Naming Conventions

| Suffix | Usage | Example |
|--------|-------|---------|
| `*Payload` | Tauri event payloads | `VoiceFlowStateChangedPayload` |
| `*Record` | SQLite database rows | `TranscriptionRecord` |
| `*Config` | Configuration objects | `HotkeyConfig` |
| `*Entry` | Dictionary/list items | `VocabularyEntry` |

### SQLite Conventions

- Table names: plural `snake_case` (e.g., `transcriptions`)
- Column names: `snake_case` in SQL, mapped to `camelCase` in TypeScript
- Booleans: stored as `INTEGER` (0/1), converted in TypeScript
- Primary keys: `TEXT` (UUID generated with `crypto.randomUUID()`)
- Parameter syntax: `$1, $2` (tauri-plugin-sql)

## Testing Guidelines

The project uses [Vitest](https://vitest.dev/) with [Testing Library](https://testing-library.com/) for React component testing.

### Running Tests

```bash
pnpm test             # Run all tests once
pnpm test:watch       # Run in watch mode during development
pnpm test:coverage    # Generate coverage report
```

### Writing Tests

- Place test files alongside source files or in the `tests/` directory.
- Name test files with the `.test.ts` or `.test.tsx` suffix.
- Test behavior, not implementation details.
- Use descriptive test names that explain the scenario being tested.
- One assertion per test when practical.
- Use the existing test utilities and helpers in `tests/support/`.

### What to Test

- Store logic (Zustand actions and derived state)
- Utility functions in `lib/`
- Component rendering and user interactions
- Do not test shadcn/ui component internals or Tauri native APIs directly.

## Translation Guide

TypeLate supports five languages. Translation files are located in `src/i18n/locales/`:

```
src/i18n/locales/
+-- en.json      # English (primary)
+-- ja.json      # Japanese
+-- ko.json      # Korean
+-- zh-TW.json   # Traditional Chinese (繁體中文)
```

### Adding or Updating Translations

1. The English file (`en.json`) is the source of truth. Add new keys there first.
2. Add the corresponding translations to all other locale files.
3. Translation keys use dot-separated namespaces (e.g., `"settings.apiKey.label"`).
4. Do not leave any keys untranslated. If a translation is not yet available, use the English text as a placeholder and note it in the PR description.

### Adding a New Language

1. Create a new JSON file in `src/i18n/locales/` (e.g., `fr.json`).
2. Copy the structure from `en.json` and translate all keys.
3. Register the new language in `src/i18n/languageConfig.ts`.
4. Add the language to the `src/i18n/index.ts` initialization.
5. Update the language selector in the settings UI.

### LLM Prompts

Language-specific LLM prompts for text enhancement are defined in `src/i18n/prompts.ts`. If you add a new language, you must also provide prompt templates in this file.

## Pull Request Process

1. **Fork the repository** and create a feature branch from `main`.
2. **Make your changes** following the conventions described above.
3. **Run checks** before submitting:
   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```
4. **Write a clear PR description** explaining what changed and why.
5. **Submit the pull request** against the `main` branch. Use the PR template provided.
6. **Address review feedback** promptly. Keep the PR focused on a single concern.

### Commit Messages

- Use clear, concise commit messages that explain the purpose of the change.
- Prefer the format: `type: short description` (e.g., `fix: resolve hotkey not triggering on macOS Sequoia`).
- Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

### What Makes a Good PR

- Focused on a single feature, bug fix, or improvement.
- Includes tests for new functionality.
- Does not introduce linter warnings or type errors.
- Follows the existing code style and patterns.
- Has a clear description of what and why, not just what files changed.
