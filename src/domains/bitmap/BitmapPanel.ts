/**
 * BitmapPanel
 * -----------
 * Webview controller for the Bitmap domain side‑panel.
 *
 * Responsibilities
 * ----------------
 * • Render the webview (cached HTML)
 * • Keep Foxtrot store and workspace memento selections in sync
 * • Provide the webview with DB / run / bitstream / notebook trees
 * • Handle webview messages and trigger VS Code commands
 *
 * Conventions
 * -----------
 * • Node‑core → third‑party → VS Code → local imports order
 * • Pure helpers live at bottom of file
 */

import { readFile } from 'fs/promises';
import path from 'path';
import * as vscode from 'vscode';

import { useFoxtrotStore } from '../../app/state';

import { BitmapProvider } from './providers/BitmapProvider';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type WebviewMsg =
  | { type: 'init' | 'poll' }
  | { type: 'dbs:select' | 'runs:select' | 'bitstreams:select'; value: string }
  | { type: 'nbs:select'; value: string }
  | { type: 'masks:browse' }
  | { type: 'panel:update'; value: unknown }
  | { type: 'analysis:create' };

/**
 * Minimal shape for Bitmap form‑state persisted in workspace memento.
 */
interface FormState {
  masks: Array<{ path: string }>;
  algo: string;
  params: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Class                                                                      */
/* -------------------------------------------------------------------------- */

export class BitmapPanel implements vscode.WebviewViewProvider {
  /** Cached webview HTML (with placeholders, no nonce) */
  private static htmlCache: string | null = null;

  private view?: vscode.WebviewView;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly model: BitmapProvider
  ) {}

  /* ─────────────── VS Code lifecycle ──────────────────────────────────── */
  public async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = { enableScripts: true };

    // ─── HTML (cached) ────────────────────────────────────────────────────
    if (!BitmapPanel.htmlCache) {
      const htmlPath = path.join(this.ctx.extensionPath, 'out/domains/bitmap/web/panel.html');
      BitmapPanel.htmlCache = await readFile(htmlPath, 'utf8');
    }
    view.webview.html = BitmapPanel.htmlCache.replace(/__nonce__/g, generateNonce());

    // ─── Wiring ───────────────────────────────────────────────────────────
    view.webview.onDidReceiveMessage((m: WebviewMsg) => this.handleWebviewMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.pushData();
      }
    });

    await this.pushData(); // first paint
  }

  /* ─────────────── Message posting helper ─────────────────────────────── */
  private postMessage(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  /* ─────────────── Data pump ──────────────────────────────────────────── */
  private async pushData(): Promise<void> {
    if (!this.view) {
      return;
    }

    this.syncStoreFromWorkspace();

    const st = useFoxtrotStore().getState();
    const ws = this.ctx.workspaceState;

    /* selections (HTML may strip leading slash) */
    const selDbFull = withSlash(st.activeBitmapDb);
    const selRunFull = withSlash(st.activeBitmapRun);
    const selRunId = selRunFull?.split('::')[1];

    const [dbs, runs, bitstreams, nbs] = await Promise.all([
      this.model.getDbTree(),
      selDbFull ? this.model.getRunTree(selDbFull) : [],
      selDbFull && selRunId ? this.model.getBitstreamTree({ db: selDbFull, run: selRunId }) : [],
      this.model.getNotebookTree(),
    ]);

    this.postMessage({
      type: 'data',
      dbs,
      runs,
      bitstreams,
      nbs,
      activeDbPath: selDbFull ?? null,
      activeRunPath: selRunFull ?? null,
      activeBsPath: st.activeBitmapBitstream ?? null,
      activeNbPath: st.activeBitmapNotebook ?? null,
      formState: ws.get('bitmap.formState') ?? null,
    });
  }

  /* ─────────────── Message handler ────────────────────────────────────── */
  private async handleWebviewMessage(msg: WebviewMsg): Promise<void> {
    const st = useFoxtrotStore().getState();
    const wsSt = this.ctx.workspaceState;

    const asAbs = (v: string) => withSlash(v)!; // non-null after switch guards

    switch (msg.type) {
      /* plain refreshes */
      case 'init':
      case 'poll': {
        await this.pushData();
        return;
      }

      /* picker selections */
      case 'dbs:select': {
        st.setActiveBitmapDb(asAbs(msg.value));
        wsSt.update('bmp.db', asAbs(msg.value));
        break;
      }
      case 'runs:select': {
        st.setActiveBitmapRun(asAbs(msg.value));
        wsSt.update('bmp.run', asAbs(msg.value));
        break;
      }
      case 'bitstreams:select': {
        st.setActiveBitmapBitstream(asAbs(msg.value));
        wsSt.update('bmp.bs', asAbs(msg.value));
        break;
      }
      case 'nbs:select': {
        st.setActiveBitmapNotebook(msg.value); // notebooks already absolute
        wsSt.update('bmp.nb', msg.value);
        break;
      }

      /* feature-mask: browse → open file dialog */
      case 'masks:browse': {
        const picks = await vscode.window.showOpenDialog({
          title: 'Select feature-mask file(s)',
          canSelectMany: true,
          canSelectFiles: true,
          canSelectFolders: false,
          openLabel: 'Add mask',
          filters: { 'Offset / mask files': ['off', 'txt', '*'] },
        });
        if (!picks?.length) {
          break;
        }

        const state: FormState = wsSt.get<FormState>('bitmap.formState') ?? {
          masks: [],
          algo: 'DBSCAN',
          params: {},
        };

        if (!Array.isArray(state.masks)) {
          state.masks = [];
        }

        for (const uri of picks) {
          const p = uri.fsPath;
          if (!state.masks.some(m => m.path === p)) {
            state.masks.push({ path: p });
          }
        }
        await wsSt.update('bitmap.formState', state);
        break;
      }

      /* form-panel value updates */
      case 'panel:update': {
        wsSt.update('bitmap.formState', msg.value);
        break;
      }

      /* create-analysis button */
      case 'analysis:create': {
        void vscode.commands.executeCommand('foxtrot.bitmap.newAnalysis');
        break;
      }
    }

    await this.pushData();
  }

  /* ─────────────── Store synchronisation ─────────────────────────────── */
  private syncStoreFromWorkspace(): void {
    const st = useFoxtrotStore().getState();
    const ws = this.ctx.workspaceState;

    const fromWS = (k: string): string | null => ws.get<string>(k) ?? null;

    if (!st.activeBitmapDb) {
      st.setActiveBitmapDb(fromWS('bmp.db'));
    }
    if (!st.activeBitmapRun) {
      st.setActiveBitmapRun(fromWS('bmp.run'));
    }
    if (!st.activeBitmapBitstream) {
      st.setActiveBitmapBitstream(fromWS('bmp.bs'));
    }
    if (!st.activeBitmapNotebook) {
      st.setActiveBitmapNotebook(fromWS('bmp.nb'));
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Prefixes a slash if missing; returns `undefined` for nullish inputs. */
function withSlash(v?: string | null): string | undefined {
  if (!v) {
    return undefined;
  }
  return v.startsWith('/') ? v : '/' + v;
}

/** Cryptographically-safe enough nonce for CSP inline-scripts. */
function generateNonce(): string {
  return Math.random().toString(36).slice(2, 18);
}
