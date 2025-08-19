/**
 * BitgenPanel
 * -----------
 * Webview view provider for the BitGen control panel.
 *
 * Responsibilities:
 * - Render panel HTML and post state to the webview.
 * - Keep VS Code workspace state and the Foxtrot store in sync.
 * - Expose commands used by the BitGen run lifecycle.
 *
 * Dependencies:
 * - VS Code Webview API
 * - BitgenProvider for EDA/Fuzzer/Part trees
 *
 * Activation Events:
 * - `onView:bitgen.panel`
 * - `onCommand:bitgenPanel.runStarted`
 * - `onCommand:bitgenPanel.runFinished`
 */

import { randomUUID as nodeRandomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';

import { useFoxtrotStore } from '../../app/state';

import { BitgenProvider } from './providers/BitgenProvider';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type EdaTree = Awaited<ReturnType<BitgenProvider['getEDATree']>>;
type FuzzerTree = Awaited<ReturnType<BitgenProvider['getFuzzerTree']>>;
type PartTree = Awaited<ReturnType<BitgenProvider['getPartTree']>>;

type InMessage =
  | { type: 'init' }
  | { type: 'poll' }
  | { type: 'fuzzer:run' }
  | { type: 'edas:select'; value: string }
  | { type: 'fuzzers:select'; value: string }
  | { type: 'parts:select'; value: string };

type OutMessage =
  | { type: 'run:started' }
  | { type: 'run:done'; success: boolean }
  | {
      type: 'data';
      edas: EdaTree;
      fuzzers: FuzzerTree;
      parts: PartTree;
      activeEDAPath: string | null;
      activeFuzzerPath: string | null;
      activePartPath: string | null;
      inProgress: boolean;
      canRun: boolean;
    };

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const FOXTROT_TERMINAL_NAME = 'Foxtrot run';
const RUN_STALE_MS = 3_000;

export class BitgenPanel implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  /** Prevent duplicate command registrations across multiple instances */
  private static commandsRegistered = false;

  /** Throttle repeated poll->push cycles */
  private pushTimer?: NodeJS.Timeout;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly model: BitgenProvider
  ) {
    if (!BitgenPanel.commandsRegistered) {
      ctx.subscriptions.push(
        vscode.commands.registerCommand('bitgenPanel.runStarted', async () => {
          await ctx.workspaceState.update('runInProgress', true);
          await ctx.workspaceState.update('runStartedAt', Date.now()); // FIX: record start time
          this.post({ type: 'run:started' });
        }),
        vscode.commands.registerCommand('bitgenPanel.runFinished', async (ok: boolean = true) => {
          await ctx.workspaceState.update('runInProgress', false);
          await ctx.workspaceState.update('runStartedAt', undefined);
          this.post({ type: 'run:done', success: ok });
        }),
        // Ensure any pending timers are cleared on disposal
        new vscode.Disposable(() => {
          if (this.pushTimer) {
            clearTimeout(this.pushTimer);
          }
        })
      );
      BitgenPanel.commandsRegistered = true;
    }
  }

  /**
   * Resolve the BitGen webview view and bootstrap initial data.
   */
  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;

    const resourceRoot = vscode.Uri.joinPath(
      this.ctx.extensionUri,
      'out',
      'domains',
      'bitgen',
      'web'
    );

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [resourceRoot], // safer: limit what the webview can load
    };

    view.webview.html = await this.loadHtml(resourceRoot);
    view.webview.onDidReceiveMessage((msg: InMessage) => void this.handle(msg));

    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.requestPushData();
      }
    });

    await this.pushData();
  }

  /* ------------------------------------------------------------------------ */
  /* Private helpers                                                          */
  /* ------------------------------------------------------------------------ */

  private async loadHtml(root: vscode.Uri): Promise<string> {
    try {
      const file = vscode.Uri.joinPath(root, 'panel.html');
      const html = await fs.readFile(file.fsPath, 'utf8');
      return html.replace(/__nonce__/g, BitgenPanel.nonce());
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return `<html><body><h2 style="color:red">BitGen panel failed to load<br/><small>${msg}</small></h2></body></html>`;
    }
  }

  private post(message: OutMessage): void {
    this.view?.webview.postMessage(message);
  }

  /**
   * Ensure Foxtrot store picks up persisted selections from workspaceState.
   * Only set via the store's setters to keep reactivity intact.
   */
  private ensureStoreSynced(): void {
    const st = useFoxtrotStore().getState();
    const ws = this.ctx.workspaceState;

    const wsEDA = ws.get<string>('activeEDAPath') ?? null;
    if ((st.activeEDA === null || st.activeEDA === undefined) && wsEDA) {
      st.setActiveEDA(wsEDA);
    }

    const wsFuzzer = ws.get<string>('activeFuzzerPath') ?? null;
    if ((st.activeFuzzer === null || st.activeFuzzer === undefined) && wsFuzzer) {
      st.setActiveFuzzer(wsFuzzer);
    }

    const wsPart = ws.get<string>('activePartPath') ?? null;
    if ((st.activePart === null || st.activePart === undefined) && wsPart) {
      st.setActivePart(wsPart);
    }
  }

  /**
   * Throttle data pushes to avoid spamming the webview on frequent polling.
   */
  private requestPushData(delayMs = 75): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
    }
    this.pushTimer = setTimeout(() => void this.pushData(), delayMs);
  }

  /**
   * Read model + state and push a single, consistent snapshot to the webview.
   */
  private async pushData(): Promise<void> {
    if (!this.view) {
      return;
    }

    this.ensureStoreSynced();

    let inProgress = this.ctx.workspaceState.get<boolean>('runInProgress') ?? false;
    if (inProgress) {
      const termExists = vscode.window.terminals.some(t => t.name === FOXTROT_TERMINAL_NAME);
      if (!termExists) {
        const startedAt = this.ctx.workspaceState.get<number>('runStartedAt') ?? 0;
        if (Date.now() - startedAt > RUN_STALE_MS) {
          inProgress = false;
          await this.ctx.workspaceState.update('runInProgress', false);
        }
      }
    }

    const [edas, fuzzers, parts] = await Promise.all([
      this.model.getEDATree(),
      this.model.getFuzzerTree(),
      this.model.getPartTree(),
    ]);

    const st = useFoxtrotStore().getState();
    const canRun = Boolean(st.activeEDA && st.activePart && st.activeFuzzer) && !inProgress;

    this.post({
      type: 'data',
      edas,
      fuzzers,
      parts,
      activeEDAPath: st.activeEDA ?? null,
      activeFuzzerPath: st.activeFuzzer ?? null,
      activePartPath: st.activePart ?? null,
      inProgress,
      canRun,
    });
  }

  private async handle(msg: InMessage): Promise<void> {
    const st = useFoxtrotStore().getState();
    const ws = this.ctx.workspaceState;

    switch (msg.type) {
      case 'init':
        await this.pushData();
        return;

      case 'edas:select':
        st.setActiveEDA(msg.value);
        await ws.update('activeEDAPath', msg.value);
        break;

      case 'fuzzers:select':
        st.setActiveFuzzer(msg.value);
        await ws.update('activeFuzzerPath', msg.value);
        break;

      case 'parts:select':
        st.setActivePart(msg.value);
        await ws.update('activePartPath', msg.value);
        break;

      case 'fuzzer:run':
        void vscode.commands.executeCommand('foxtrot.runActiveFuzzer');
        return;

      case 'poll':
        this.requestPushData();
        return;

      default: {
        // Exhaustiveness guard if new message types are added later
        return;
      }
    }

    await this.pushData();
  }
  private static nonce(): string {
    // Prefer Node's crypto.randomUUID if available; fall back to Math.random
    try {
      const uuid = typeof nodeRandomUUID === 'function' ? nodeRandomUUID() : undefined;
      return (uuid ?? Math.random().toString(36)).replace(/[^a-z0-9]/gi, '').slice(0, 16);
    } catch {
      return Math.random().toString(36).slice(2, 18);
    }
  }
}
