# Souimagery VS Code Assistant (Beginner Friendly)

Yes — **it is possible to make your extension look and behave like the screenshot** (chat + live updates + file-aware coding help).  
What you have now is a starter. The screenshot style is the next level: better UI + streaming + patch review + run/test loop.

This guide shows exactly how to set that up on **Fedora Linux**.

---

## 0) What “Phase 2” actually means

Phase 2 = your extension stops being a simple chatbot and becomes an **IDE assistant**:

1. **Streaming tokens** → AI types live.
2. **File-aware context** → AI sees your active file.
3. **Patch workflow** → AI proposes code edits, you apply/review.
4. **Tool loop** → run commands (build/test/lint), then AI fixes errors.
5. **Project context** → optional workspace indexing cache.

---

## 1) Fedora terminal setup (exact commands)

### Install prerequisites

```bash
sudo dnf update -y
sudo dnf install -y git curl
sudo dnf install -y nodejs npm
node -v
npm -v
```

> If Node is too old (< 20), install a newer one (nvm recommended).

### Install VS Code extension scaffolding tools

```bash
npm install -g yo generator-code typescript
```

### Create extension

```bash
mkdir my-codex-sidebar
cd my-codex-sidebar
yo code
```

Choose:

- `TypeScript`
- `New Webview Extension`

### Run it

```bash
npm install
npm run compile
code .
```

In VS Code, press **F5**.

A new Extension Development Host opens with your sidebar extension.

---

## 2) Configure API key safely (do NOT hardcode)

Open:

- `File` → `Preferences` → `Settings`
- search `Open Settings (JSON)`

Add:

```json
{
  "souimagery.apiKey": "YOUR_REAL_KEY",
  "souimagery.baseUrl": "https://api.souimagery.fun/v1",
  "souimagery.model": "gpt-5.3-codex"
}
```

Never commit real keys to Git.

---

## 3) How streaming works (Phase 2 feature #1)

### Idea

- Send request with `stream: true`.
- Server sends chunks as SSE lines (`data: ...`).
- Parse each line.
- Send each token to webview (`postMessage`).
- Webview appends token to output text.

### Backend flow

1. `fetch('/chat/completions', { stream: true })`
2. `res.body.getReader()`
3. decode chunks via `TextDecoder`
4. split by `\n`
5. parse `data: ...`
6. emit `{ type: 'token', text: token }`

### Frontend flow

- listen to `window.addEventListener('message', ...)`
- when message type is `token`, append text in chat bubble/preview

This is what gives ChatGPT/Copilot-like typing.

---

## 4) How file-aware context works (Phase 2 feature #2)

### Idea

Read the open editor file and prepend it to the prompt.

### Practical flow

1. `const editor = vscode.window.activeTextEditor`
2. if exists, gather:
   - `editor.document.fileName`
   - `editor.document.getText()`
3. build prompt like:
   - `File: ...`
   - file contents in triple backticks
   - `User request: ...`
4. send that in user message

Now AI answers based on actual code, not generic guesses.

---

## 5) Make it look more like your screenshot

Your screenshot has:

- structured bullet summary
- “verified commands” section
- per-file change counts
- review/apply controls

To approximate that in your extension:

1. Render Markdown in chat output.
2. Ask model to respond with sections:
   - `Summary`
   - `Changes by file`
   - `Commands to run`
3. Add a “Run Command” action (with confirmation).
4. Add “Apply Diff” and “Undo” actions.
5. Track changed files and show a mini diff list.

---

## 6) Terminal command loop (Fedora)

Once assistant suggests fixes, run commands in terminal:

```bash
php -l admin/portal.php
php -l admin/attendance-pending.php
node --check src/admin/attendance-pending/main.jsx
npm run build
```

Then paste output back into chat so assistant can propose next fixes.

---

## 7) Recommended upgrade path (small steps)

1. Stable chat send/receive
2. Streaming tokens
3. File-aware context
4. Diff-only apply (not full overwrite)
5. Command runner with allowlist
6. Workspace indexing cache
7. Better UI (cards, verification section, file counters)

Do not jump to everything at once.

---

## 8) Common mistakes on Fedora

- running F5 outside extension folder
- forgetting `npm run compile`
- missing API key in settings
- hardcoding keys into source files
- applying raw AI output without diff validation

---

## 9) Direct answer to your question

> “Is it possible to look like this? How does Phase 2 work? How to set up in Fedora terminal?”

**Yes, possible.**  
Your current project can evolve into that style. Start with the exact Fedora commands above, then add Phase 2 features in this order:

- streaming,
- file context,
- diff apply,
- command/test loop,
- UI polish.

If you want, next step I can generate a **drop-in `webview.html` + `extension.ts` pair** that gives a closer screenshot-like layout (summary blocks, verified command list, and file-change cards).
