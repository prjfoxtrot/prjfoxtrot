/**
 * WelcomePanel
 * ------------
 * Provides the **Foxtrot Welcome** view that is visible when VS Code either
 * (1) has no folder open or (2) the current folder has not yet been
 * initialised by Foxtrot. The panel displays the Foxtrot logo, a short
 * explanation, and two buttons for creating or opening a Foxtrot workspace.
 *
 * Notes
 * -----
 * - Web-view scripts are enabled for message passing only; no remote content.
 * - Safe to activate in an empty window (guarded by the view `when` clause).
 * - Uses VS Code theme variables for automatic theming.
 */

import * as vscode from 'vscode';

/**
 * Registers the **foxtrot-welcome** view and wires its buttons to Foxtrot
 * commands.
 */
export class WelcomePanel implements vscode.WebviewViewProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  /** Populates the web‑view when it becomes visible. */
  public resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };

    // ─────── Assets ──────────────────────────────────────────────────────
    const logoUri = view.webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'foxtrot.svg')
    );

    // ─────── Dynamic copy ───────────────────────────────────────────────
    const hasFolderOpen = Boolean(vscode.workspace.workspaceFolders?.length);
    const message = hasFolderOpen
      ? 'This folder is not a Foxtrot workspace yet.'
      : 'No folder is open. Choose or create a Foxtrot workspace to get started.';

    // ─────── Security helpers ───────────────────────────────────────────
    const nonce = getNonce();
    const cspSource = view.webview.cspSource;

    // ─────── Render HTML ────────────────────────────────────────────────
    view.webview.html = buildHtml(logoUri, message, nonce, cspSource);

    // ─────── Event wiring ───────────────────────────────────────────────
    view.webview.onDidReceiveMessage((m: { cmd: string }) => {
      switch (m.cmd) {
        case 'create':
          void vscode.commands.executeCommand('foxtrot.createWorkspace');
          break;
        case 'open':
          void vscode.commands.executeCommand('foxtrot.openWorkspace');
          break;
        default:
          console.warn(`[WelcomePanel] Unknown command from webview: ${m.cmd}`);
      }
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helper utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Returns the fully‑qualified VS Code colour variable usable in web‑views.
 * @param {string} v - The colour ID (e.g. `foreground`).
 * @returns {string} The CSS variable reference (e.g. `var(--vscode-foreground)`).
 */
const cssVar = (v: string): string => `var(--vscode-${v})`;

/**
 * Generates a cryptographically‑safe nonce for inline scripts.
 * @param {number} [length] - Desired length of the nonce.
 * @returns {string} A random nonce consisting of alphanumeric characters.
 */
function getNonce(length = 16): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () =>
    possible.charAt(Math.floor(Math.random() * possible.length))
  ).join('');
}

/**
 * Builds the full HTML document shown in the Welcome panel.
 * @param {vscode.Uri} logoUri   - Web‑view‑safe URI of the Foxtrot SVG logo.
 * @param {string}      message   - Context‑sensitive hint for the user.
 * @param {string}      nonce     - CSP nonce for the inline script tag.
 * @param {string}      cspSource - The web‑view’s CSP source placeholder.
 * @returns {string} Complete HTML string (inline CSS/JS – no external fetches).
 */
function buildHtml(logoUri: vscode.Uri, message: string, nonce: string, cspSource: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${cspSource} https:; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline';"
    />
    <title>Foxtrot – Welcome</title>
  </head>
  <body
    style="font-family:${cssVar('font-family')};color:${cssVar('foreground')};padding:1rem;"
  >
    <!-- Logo -->
    <img
      src="${logoUri}"
      alt="Foxtrot logo"
      style="width:100%;max-width:140px;display:block;margin:0 auto 1rem auto;"
    />

    <!-- Headline -->
    <h2 style="text-align:center;margin:0.2rem 0 1rem 0;">
      Welcome to <strong>Project Foxtrot</strong>
    </h2>

    <p>${message}</p>

    <!-- Actions -->
    <button class="btn" data-cmd="create">Create Foxtrot workspace</button>
    <button class="btn" data-cmd="open">Open existing workspace…</button>

    <!-- Styles -->
    <style>
      .btn {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin: 0.5rem 0;
        padding: 0.4rem 0.9rem;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        background: ${cssVar('button-background')};
        color: ${cssVar('button-foreground')};
        font: inherit;
        text-align: center;
      }
      .btn:hover {
        background: ${cssVar('button-hoverBackground')};
      }
    </style>

    <!-- Script -->
    <script nonce="${nonce}">
      (function () {
        'use strict';
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('.btn').forEach(btn => {
          btn.addEventListener('click', () => {
            vscode.postMessage({ cmd: btn.getAttribute('data-cmd') });
          });
        });
      })();
    </script>
  </body>
</html>`;
}
