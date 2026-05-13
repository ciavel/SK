# Codex-Style VS Code Sidebar Assistant (Beginner-Friendly)

This project is a **simple VS Code extension** that can grow into a more powerful coding assistant.

If you are new, do not worry—we will do this step by step.

---

## What You Are Building

You are building a sidebar chat assistant inside VS Code that can:

- chat with an AI model,
- read your current file for context,
- stream responses token-by-token (typing effect),
- and apply AI-generated edits.

Think of this as a lightweight, self-hosted path toward a Copilot/Codex-style experience.

---

## Before You Start

Make sure you have:

- **Node.js + npm** installed
- **VS Code** installed
- basic terminal usage (copy/paste commands)

---

## Phase 1: Get the First Working Extension

### 1) Install VS Code extension scaffolding tools

Run this in terminal:

```bash
npm install -g yo generator-code
```

### 2) Create a new extension project

```bash
yo code
```

Choose these options:

- `TypeScript`
- `New Webview Extension`

### 3) Replace generated files

Replace the generated:

- `package.json` (with your sidebar-enabled config)
- `src/extension.ts` (with your webview provider implementation)

> Tip: Keep a backup copy of generated files in case you need to compare.

### 4) Install dependencies and compile

Inside the extension folder:

```bash
npm install
npm run compile
```

### 5) Launch Extension Development Host

```bash
code .
```

Then press `F5` in VS Code.

A new VS Code window opens with your extension loaded.

You should see your sidebar view (for example: `🧠 Codex` → `Chat`).

### 6) Add extension settings (API config)

Open **Settings JSON** in VS Code and add:

```json
{
  "souimagery.apiKey": "YOUR_KEY",
  "souimagery.baseUrl": "https://api.souimagery.fun/v1",
  "souimagery.model": "gpt-5.3-codex"
}
```

---

## Phase 2: Upgrade It to Agent-Like Behavior

Now that the extension runs, add features one at a time.

---

### 1) Streaming tokens (live typing)

Why this matters:

- users see responses appear live,
- faster perceived performance,
- feels like ChatGPT/Copilot style chat.

Implementation idea:

- send `stream: true` in your chat request,
- read response chunks with `ReadableStream.getReader()`,
- parse `data: ...` SSE lines,
- forward each token to your webview with `webview.postMessage({ type: "token", text })`.

---

### 2) File-aware context (critical for code quality)

Why this matters:

- the model answers based on the actual file you are editing,
- better suggestions, fewer generic answers.

Implementation idea:

- read `vscode.window.activeTextEditor`,
- collect file name + full file text,
- prepend this context to the user prompt.

---

### 3) Apply Patch button (real IDE power)

Why this matters:

- users can quickly apply AI output into editor,
- reduces copy/paste friction.

Implementation idea:

- add **Apply Patch** button in webview,
- send `applyPatch` message to extension host,
- replace current document text via `WorkspaceEdit`.

> Beginner safety tip: start with full-file replace, then later move to diff-based patching.

---

### 4) Multi-file agent mode (advanced)

Why this matters:

- model can reason across project files,
- useful for refactoring and bug fixing.

Implementation idea:

- scan files with `vscode.workspace.findFiles("**/*.{ts,js,py}")`,
- read each file,
- send trimmed/summarized context to model,
- include a system role like: *"You are a coding agent with full project access."*

> Important: Add limits. Sending entire large repositories can be expensive and slow.

---

## Suggested Build Order (Do This Exactly)

1. Sidebar loads in VS Code.
2. Single prompt → single response works.
3. Add streaming responses.
4. Add current-file context.
5. Add apply-patch behavior.
6. Add multi-file support with token limits.

This order keeps debugging simple.

---

## Common Beginner Mistakes

- Running `F5` outside the extension project folder.
- Forgetting `npm run compile` before launch.
- Not setting API key in settings.
- Sending too much workspace content and hitting token limits.
- Replacing files blindly without user confirmation.


