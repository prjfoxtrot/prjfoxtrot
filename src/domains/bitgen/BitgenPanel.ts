/**
 * BitgenPanel
 * -----------
 * Web‑view controller for the *Bit‑Generation* phase.
 *
 * ‣ Presents the sidebar UI (panel.html) and hydrates it with data obtained from
 *   {@link BitgenProvider} and the global Foxtrot store.
 * ‣ Listens for messages from the web‑view and persists the user’s selections
 *   into both the store and {@link vscode.Memento}.
 * ‣ Exposes `bitgenPanel.runStarted` / `bitgenPanel.runFinished` commands so that
 *   the backend process can toggle the spinner + run‑button state.
 */

import * as fs from 'fs/promises';
import * as vscode from 'vscode';

import { useFoxtrotStore } from '../../app/state';

import { BitgenProvider } from './providers/BitgenProvider';

export class BitgenPanel implements vscode.WebviewViewProvider {
  /** Handle to the web-view – becomes available after `resolveWebviewView`. */
  private view?: vscode.WebviewView;

  /** Guard so we register run‑state commands just once. */
  private static commandsRegistered = false;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly model: BitgenProvider
  ) {
    /* Commands must be registered exactly once – the first time a panel is constructed. */
    if (!BitgenPanel.commandsRegistered) {
      ctx.subscriptions.push(
        vscode.commands.registerCommand('bitgenPanel.runStarted', async () => {
          await ctx.workspaceState.update('runInProgress', true);
          this.post({ type: 'run:started' });
        }),
        vscode.commands.registerCommand('bitgenPanel.runFinished', async (ok: boolean = true) => {
          await ctx.workspaceState.update('runInProgress', false);
          await ctx.workspaceState.update('runStartedAt', undefined);
          this.post({ type: 'run:done', success: ok });
        })
      );
      BitgenPanel.commandsRegistered = true;
    }
  }

  /*───────────────────────── VS Code lifecycle ────────────────────────────*/

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true };

    // Load panel HTML + inject fresh nonce for CSP.
    view.webview.html = await this.loadHtml();

    // Wire message pump.
    view.webview.onDidReceiveMessage(msg => void this.handle(msg));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.pushData();
      }
    });

    await this.pushData(); // initial paint
  }

  /*──────────────────────────── helpers ───────────────────────────────────*/

  /** Reads `panel.html` from disk and injects a random nonce. */
  private async loadHtml(): Promise<string> {
    try {
      const file = vscode.Uri.joinPath(
        this.ctx.extensionUri,
        'out',
        'domains',
        'bitgen',
        'web',
        'panel.html'
      );
      const html = await fs.readFile(file.fsPath, 'utf8');
      return html.replace(/__nonce__/g, BitgenPanel.nonce());
    } catch (err) {
      /* eslint-disable-next-line @typescript-eslint/restrict-template-expressions */
      return `<html><body><h2 style="color:red">Bit-Gen panel failed to load<br/><small>${
        (err as Error).message
      }</small></h2></body></html>`;
    }
  }

  /** Post a message to the web‑view, if available. */
  private post(message: unknown): void {
    this.view?.webview.postMessage(message);
  }

  /** Sync the zustand store with persisted workspace‑state selections. */
  private ensureStoreSynced(): void {
    const st = useFoxtrotStore().getState();
    const ws = this.ctx.workspaceState;

    st.activePlugin ??= ws.get<string>('activePluginPath') ?? null;
    st.activeFuzzer ??= ws.get<string>('activeFuzzerPath') ?? null;
    st.activePart ??= ws.get<string>('activePartPath') ?? null;
  }

  /** Gather data + run‑state and push to the web‑view. */
  private async pushData(): Promise<void> {
    if (!this.view) {
      return;
    }

    this.ensureStoreSynced();

    /* Grace-period healing – auto-clear stale flag when the terminal disappears. */
    let inProgress = this.ctx.workspaceState.get<boolean>('runInProgress') ?? false;
    if (inProgress) {
      const termExists = vscode.window.terminals.some(t => t.name === 'Foxtrot run');
      if (!termExists) {
        const startedAt = this.ctx.workspaceState.get<number>('runStartedAt') ?? 0;
        if (Date.now() - startedAt > 3000) {
          inProgress = false;
          await this.ctx.workspaceState.update('runInProgress', false);
        }
      }
    }

    const [plugins, fuzzers, parts] = await Promise.all([
      this.model.getPluginTree(),
      this.model.getFuzzerTree(),
      this.model.getPartTree(),
    ]);

    const st = useFoxtrotStore().getState();
    const canRun = Boolean(st.activePlugin && st.activePart && st.activeFuzzer) && !inProgress;

    this.post({
      type: 'data',
      plugins,
      fuzzers,
      parts,
      activePluginPath: st.activePlugin,
      activeFuzzerPath: st.activeFuzzer,
      activePartPath: st.activePart,
      inProgress,
      canRun,
    } as const);
  }

  /*──────────────────── web-view → extension bridge ───────────────────────*/

  /**
   * Dispatches messages received from the web-view.
   * `any` is avoided to satisfy `@typescript-eslint/no-explicit-any`.
   */
  private async handle(msg: Record<string, unknown>): Promise<void> {
    const st = useFoxtrotStore().getState();
    const ws = this.ctx.workspaceState;

    switch (msg.type) {
      case 'init':
        await this.pushData();
        return;

      case 'plugins:select':
        if (typeof msg.value === 'string') {
          st.setActivePlugin(msg.value);
          ws.update('activePluginPath', msg.value);
        }
        break;

      case 'fuzzers:select':
        if (typeof msg.value === 'string') {
          st.setActiveFuzzer(msg.value);
          ws.update('activeFuzzerPath', msg.value);
        }
        break;

      case 'parts:select':
        if (typeof msg.value === 'string') {
          st.setActivePart(msg.value);
          ws.update('activePartPath', msg.value);
        }
        break;

      case 'fuzzer:run':
        void vscode.commands.executeCommand('foxtrot.runActiveFuzzer');
        return; // spinner toggled via events

      case 'poll':
        await this.pushData();
        return;

      default:
        return; // silently ignore unknown messages
    }

    await this.pushData();
  }

  /*──────────────────────────── utilities ─────────────────────────────────*/

  /** Strongly random nonce used by inline scripts (CSP). */
  private static nonce(): string {
    return Math.random().toString(36).slice(2, 18);
  }
}
