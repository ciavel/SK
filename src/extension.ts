import * as vscode from "vscode";

type WebviewMessage =
  | { type: "ask"; prompt?: string }
  | { type: "applyPatch"; patch?: string }
  | { type: "runTests" }
  | { type: "openTerminal"; name?: string }
  | { type: "refreshIndex" };

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("souimagery.chatView", provider),
    vscode.commands.registerCommand("souimagery.refreshDiagnostics", async () => {
      const messages = await provider.refreshDiagnostics();
      const detail = messages.length
        ? `Potential refactor signals: ${messages.length}`
        : "No TODO-style diagnostics found.";
      void vscode.window.showInformationMessage(detail);
    })
  );
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  private workspaceSummary = "";

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      if (msg.type === "applyPatch") {
        await this.applyDiffOrWarn(String(msg.patch || ""));
        return;
      }

      if (msg.type === "runTests") {
        await vscode.commands.executeCommand("workbench.action.tasks.runTask");
        return;
      }

      if (msg.type === "openTerminal") {
        const terminal = vscode.window.createTerminal({ name: msg.name || "Souimagery Agent" });
        terminal.show();
        return;
      }

      if (msg.type === "refreshIndex") {
        await this.refreshIndex();
        webviewView.webview.postMessage({ type: "indexed", text: this.workspaceSummary });
        return;
      }

      if (msg.type !== "ask") return;
      await this.askModel(webviewView, String(msg.prompt || ""));
    });
  }

  async refreshDiagnostics(): Promise<string[]> {
    const files = await vscode.workspace.findFiles("**/*.{ts,tsx,js,jsx,md}", "**/{node_modules,dist,out}/**", 120);
    const todoSignals: string[] = [];

    for (const file of files.slice(0, 40)) {
      const text = (await vscode.workspace.fs.readFile(file)).toString();
      if (/\bTODO\b/i.test(text)) {
        todoSignals.push(vscode.workspace.asRelativePath(file));
      }
    }

    return todoSignals;
  }

  private async refreshIndex(): Promise<void> {
    const files = await vscode.workspace.findFiles("**/*", "**/{node_modules,dist,out,.git}/**", 300);
    const rel = files.map((uri: vscode.Uri) => vscode.workspace.asRelativePath(uri));

    const summary = [
      `Workspace files indexed: ${rel.length}`,
      "Sample paths:",
      ...rel.slice(0, 80).map((f: string) => `- ${f}`)
    ].join("\n");

    this.workspaceSummary = summary;
    await this.context.workspaceState.update("souimagery.workspaceSummary", summary);
  }

  private async askModel(webviewView: vscode.WebviewView, userPrompt: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("souimagery");
    const apiKey = cfg.get<string>("apiKey") || "";
    const baseUrl = (cfg.get<string>("baseUrl") || "https://api.souimagery.fun/v1").replace(/\/+$/, "");
    const model = cfg.get<string>("model") || "gpt-5.3-codex";

    if (!apiKey) {
      webviewView.webview.postMessage({ type: "error", text: "Set souimagery.apiKey in Settings first." });
      return;
    }

    const editor = vscode.window.activeTextEditor;
    const fileContext = editor
      ? `File: ${editor.document.fileName}\n\n${editor.document.getText()}\n\n`
      : "";

    const cached = this.workspaceSummary || this.context.workspaceState.get<string>("souimagery.workspaceSummary") || "";
    const systemInstruction = [
      "You are in agent mode.",
      "When proposing edits, return a fenced ```diff block only.",
      cached ? `Workspace summary:\n${cached}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: `${fileContext}\nUser request:\n${userPrompt}` }
          ]
        })
      });

      if (!res.ok || !res.body) {
        webviewView.webview.postMessage({ type: "error", text: `HTTP ${res.status}` });
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
            webviewView.webview.postMessage({ type: "done" });
            return;
          }
          const parsed = JSON.parse(json);
          const token = parsed?.choices?.[0]?.delta?.content;
          if (token) webviewView.webview.postMessage({ type: "token", text: token });
        }
      }
    } catch (error) {
      webviewView.webview.postMessage({ type: "error", text: String(error) });
    }
  }

  private async applyDiffOrWarn(responseText: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const match = responseText.match(/```diff\s*([\s\S]*?)```/i);
    if (!match) {
      void vscode.window.showWarningMessage("No diff block found. Nothing applied.");
      return;
    }

    const diffBody = match[1];
    const addedLines = diffBody
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));

    if (!addedLines.length) {
      void vscode.window.showWarningMessage("Diff parsed, but no added lines to apply.");
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length)
    );
    edit.replace(editor.document.uri, fullRange, addedLines.join("\n"));
    await vscode.workspace.applyEdit(edit);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!doctype html><html><body>
      <textarea id="prompt" rows="6" style="width:100%" placeholder="Ask in agent mode..."></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button id="send">Send</button>
        <button id="apply">Apply Diff</button>
        <button id="tests">Run Tests Tool</button>
        <button id="term">Open Terminal Tool</button>
        <button id="index">Refresh Index</button>
      </div>
      <pre id="out" style="white-space:pre-wrap"></pre>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const out = document.getElementById('out');
        let responseText = '';

        document.getElementById('send').onclick = () => {
          responseText = '';
          out.textContent = 'Thinking...';
          vscode.postMessage({ type: 'ask', prompt: document.getElementById('prompt').value });
        };

        document.getElementById('apply').onclick = () => vscode.postMessage({ type: 'applyPatch', patch: responseText });
        document.getElementById('tests').onclick = () => vscode.postMessage({ type: 'runTests' });
        document.getElementById('term').onclick = () => vscode.postMessage({ type: 'openTerminal', name: 'Souimagery Agent' });
        document.getElementById('index').onclick = () => vscode.postMessage({ type: 'refreshIndex' });

        window.addEventListener('message', (event) => {
          const msg = event.data;
          if (msg.type === 'token') {
            responseText += msg.text;
            out.textContent = responseText;
          }
          if (msg.type === 'indexed') out.textContent = msg.text;
          if (msg.type === 'error') out.textContent = 'Error: ' + msg.text;
        });
      </script>
    </body></html>`;
  }
}

export function deactivate() {}
