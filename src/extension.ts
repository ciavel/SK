import * as vscode from "vscode";

const SYSTEM_PROMPT = [
  "You are a coding assistant inside VS Code.",
  "When editing code, prefer returning unified diff blocks fenced as ```diff```.",
  "Explain what changed in a short bullet list before the diff."
].join(" ");

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("souimagery.chatView", provider));

  const diag = vscode.languages.createDiagnosticCollection("souimagery");
  context.subscriptions.push(diag);

  const refreshDiagnostics = vscode.commands.registerCommand("souimagery.refreshDiagnostics", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const text = editor.document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    const todo = text.indexOf("TODO");
    if (todo >= 0) {
      const start = editor.document.positionAt(todo);
      const end = editor.document.positionAt(todo + 4);
      diagnostics.push(new vscode.Diagnostic(new vscode.Range(start, end), "TODO found. Consider resolving before commit.", vscode.DiagnosticSeverity.Information));
    }

    diag.set(editor.document.uri, diagnostics);
    void vscode.window.showInformationMessage("Souimagery diagnostics refreshed.");
  });
  context.subscriptions.push(refreshDiagnostics);
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  private workspaceIndexCache = "";

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "refreshIndex") {
        this.workspaceIndexCache = await buildWorkspaceIndex();
        webviewView.webview.postMessage({ type: "indexReady", size: this.workspaceIndexCache.length });
        return;
      }

      if (msg.type === "applyPatch") {
        await this.applyPatchFromDiff(String(msg.patch || ""));
        return;
      }

      if (msg.type === "runTool") {
        await this.runTool(String(msg.tool || ""), webviewView.webview);
        return;
      }

      if (msg.type !== "ask") return;
      await this.askModel(webviewView.webview, String(msg.prompt || ""));
    });
  }

  private async askModel(webview: vscode.Webview, prompt: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("souimagery");
    const apiKey = cfg.get<string>("apiKey") || "";
    const baseUrl = (cfg.get<string>("baseUrl") || "https://api.souimagery.fun/v1").replace(/\/+$/, "");
    const model = cfg.get<string>("model") || "gpt-5.3-codex";

    if (!apiKey) {
      webview.postMessage({ type: "error", text: "Set souimagery.apiKey in Settings first." });
      return;
    }

    const editor = vscode.window.activeTextEditor;
    const fileContext = editor
      ? `File: ${editor.document.fileName}\n\n\
\
${editor.document.getText()}\n\
\
`
      : "";

    const contextSummary = this.workspaceIndexCache ? `\nWorkspace index summary:\n${this.workspaceIndexCache}` : "";

    const messages: ChatMsg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${fileContext}${contextSummary}\nUser request:\n${prompt}` }
    ];

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, stream: true, messages })
      });

      if (!res.ok || !res.body) {
        webview.postMessage({ type: "error", text: `HTTP ${res.status}` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            webview.postMessage({ type: "done" });
            return;
          }
          const parsed = JSON.parse(json);
          const token = parsed?.choices?.[0]?.delta?.content;
          if (token) webview.postMessage({ type: "token", text: token });
        }
      }
    } catch (error) {
      webview.postMessage({ type: "error", text: String(error) });
    }
  }

  private async applyPatchFromDiff(responseText: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const diffMatch = responseText.match(/```diff\n([\s\S]*?)```/);
    if (!diffMatch) {
      await vscode.window.showWarningMessage("No ```diff``` block found. Keeping file unchanged.");
      return;
    }

    const newText = extractAddedLines(diffMatch[1]);
    if (!newText.trim()) {
      await vscode.window.showWarningMessage("Parsed diff had no added content.");
      return;
    }

    const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
    await editor.edit((editBuilder) => editBuilder.replace(fullRange, newText));
  }

  private async runTool(tool: string, webview: vscode.Webview): Promise<void> {
    if (tool === "runTests") {
      await vscode.commands.executeCommand("workbench.action.tasks.runTask");
      webview.postMessage({ type: "toolResult", text: "Opened VS Code task runner. Select your test task." });
      return;
    }

    if (tool === "openTerminal") {
      const terminal = vscode.window.createTerminal("Souimagery Agent Terminal");
      terminal.show();
      webview.postMessage({ type: "toolResult", text: "Terminal opened." });
      return;
    }

    webview.postMessage({ type: "toolResult", text: `Unknown tool: ${tool}` });
  }

  private getHtml(): string {
    return `<!doctype html><html><body>
      <textarea id="prompt" rows="5" style="width:100%" placeholder="Ask about code or image findings..."></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
        <button id="send">Send</button>
        <button id="apply">Apply Diff Preview</button>
        <button id="index">Refresh Project Index</button>
        <button id="tests">Run Tests Tool</button>
        <button id="terminal">Open Terminal Tool</button>
      </div>
      <pre id="out" style="white-space:pre-wrap"></pre>
      <script>
        const vscode = acquireVsCodeApi();
        const out = document.getElementById('out');
        let responseText = '';
        document.getElementById('send').onclick = () => {
          responseText = '';
          out.textContent = 'Thinking...';
          vscode.postMessage({ type: 'ask', prompt: document.getElementById('prompt').value });
        };
        document.getElementById('apply').onclick = () => vscode.postMessage({ type: 'applyPatch', patch: responseText });
        document.getElementById('index').onclick = () => vscode.postMessage({ type: 'refreshIndex' });
        document.getElementById('tests').onclick = () => vscode.postMessage({ type: 'runTool', tool: 'runTests' });
        document.getElementById('terminal').onclick = () => vscode.postMessage({ type: 'runTool', tool: 'openTerminal' });

        window.addEventListener('message', (event) => {
          const msg = event.data;
          if (msg.type === 'token') {
            responseText += msg.text;
            out.textContent = responseText;
          }
          if (msg.type === 'toolResult') out.textContent = msg.text;
          if (msg.type === 'indexReady') out.textContent = 'Index refreshed. Cached chars: ' + msg.size;
          if (msg.type === 'error') out.textContent = 'Error: ' + msg.text;
        });
      </script>
    </body></html>`;
  }
}

function extractAddedLines(diffBody: string): string {
  return diffBody
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

async function buildWorkspaceIndex(): Promise<string> {
  const files = await vscode.workspace.findFiles("**/*.{ts,tsx,js,jsx,py,md,json}", "**/{node_modules,.git,out}/**", 60);
  const chunks: string[] = [];

  for (const f of files) {
    const doc = await vscode.workspace.openTextDocument(f);
    const preview = doc.getText().slice(0, 300).replace(/\s+/g, " ").trim();
    chunks.push(`- ${vscode.workspace.asRelativePath(f)}: ${preview}`);
  }

  return chunks.join("\n");
}

export function deactivate() {}
