import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("souimagery.chatView", provider)
  );
}

class ChatViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "applyPatch") {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(editor.document.getText().length)
        );
        edit.replace(editor.document.uri, fullRange, String(msg.patch || ""));
        await vscode.workspace.applyEdit(edit);
        return;
      }
      if (msg.type !== "ask") return;

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
        ? `File: ${editor.document.fileName}\n\n\
\
${editor.document.getText()}\n\
\
`
        : "";

      const userPrompt = String(msg.prompt || "");

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            stream: true,
            messages: [
              {
                role: "user",
                content: `${fileContext}\nUser request:\n${userPrompt}`
              }
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
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!doctype html><html><body>
      <textarea id="prompt" rows="5" style="width:100%" placeholder="Ask about code or image findings..."></textarea>
      <button id="send">Send</button>
      <button id="apply">Apply response to current file</button>
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

        document.getElementById('apply').onclick = () => {
          vscode.postMessage({ type: 'applyPatch', patch: responseText });
        };

        window.addEventListener('message', (event) => {
          const msg = event.data;
          if (msg.type === 'token') {
            responseText += msg.text;
            out.textContent = responseText;
          }
          if (msg.type === 'error') out.textContent = 'Error: ' + msg.text;
        });
      </script>
    </body></html>`;
  }
}

export function deactivate() {}
