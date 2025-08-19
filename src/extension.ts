/* -------------------------------------------------------------------------- */
/* Foxtrot VS Code Extension – Entry Point                                    */
/* -------------------------------------------------------------------------- */
/**
 * Initialises global state, registers domains & commands and wires the UI for
 * the Foxtrot FPGA reverse-engineering toolkit.
 *
 * Responsibilities:
 *  • Boot-strapping newly-opened workspaces when required.
 *  • Surfacing the currently selected FPGA part in the status-bar.
 *  • Delegating tree & webview registration to the respective domain modules.
 *
 */

import * as vscode from 'vscode';

import { initState, useFoxtrotStore } from './app/state';
import { bootstrapWorkspace } from './commands/bootstrapWorkspace';
import { createBitmapAnalysis as createBitmapAnalysis } from './commands/createBitmapAnalysis';
import { createWorkspace } from './commands/createWorkspace';
import { reinstallPackages } from './commands/reinstallPackages';
import { spawnFoxtrotRun } from './commands/spawnFoxtrotRun';
import * as switchPhase from './commands/switchPhase';
import { registerDomains } from './domains';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const INIT_CTX_KEY = 'foxtrot.isInitialised';

/* -------------------------------------------------------------------------- */
/* Helper functions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Quick file-existence helper scoped to a workspace folder.
 */
const fileExists = async (ws: vscode.WorkspaceFolder, relPath: string): Promise<boolean> => {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(ws.uri, relPath));
    return true;
  } catch {
    return false;
  }
};

/**
 * Determines whether the given workspace folder has already been initialised
 * by Foxtrot.
 */
const isWorkspaceReady = async (ws: vscode.WorkspaceFolder): Promise<boolean> =>
  (await fileExists(ws, 'project_settings.toml')) ||
  ((await fileExists(ws, '.foxtrot-init')) && (await fileExists(ws, '.venv')));

/**
 * Updates the context key that gates views & activation events in `package.json`.
 */
const refreshContextKey = async (): Promise<void> => {
  const ws = vscode.workspace.workspaceFolders?.[0];
  await vscode.commands.executeCommand(
    'setContext',
    INIT_CTX_KEY,
    !!ws && (await isWorkspaceReady(ws))
  );
};

/**
 * Ensures the current workspace is boot-strapped exactly once.
 */
const maybeBootstrapWorkspace = async (ctx: vscode.ExtensionContext): Promise<void> => {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) {
    return;
  }

  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(ws.uri, '.foxtrot-init'));
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(ws.uri, '.venv'));
  } catch {
    await bootstrapWorkspace(ctx);
  }
};

/* -------------------------------------------------------------------------- */
/* UI helpers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates and wires a status-bar item that surfaces the active FPGA part.
 */
const createActivePartStatusBar = (ctx: vscode.ExtensionContext): void => {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  const render = () => {
    const part = useFoxtrotStore().getState().activePart;
    item.text = part ? `FPGA: ${part.split('/').pop()}` : '';
  };

  render();
  item.show();

  const unsubscribe = useFoxtrotStore().subscribe(render);
  ctx.subscriptions.push(item, { dispose: unsubscribe });
};

/* -------------------------------------------------------------------------- */
/* Command registration                                                       */
/* -------------------------------------------------------------------------- */

const registerCommands = (ctx: vscode.ExtensionContext): void => {
  const cmd = vscode.commands.registerCommand;

  ctx.subscriptions.push(
    cmd('foxtrot.createWorkspace', () => createWorkspace(ctx)),

    cmd('foxtrot.openWorkspace', async () => {
      const [folder] =
        (await vscode.window.showOpenDialog({
          openLabel: 'Open Foxtrot workspace',
          canSelectFolders: true,
          canSelectMany: false,
        })) ?? [];

      if (folder) {
        void vscode.commands.executeCommand('vscode.openFolder', folder, false);
      }
    }),

    cmd('foxtrot.runActiveFuzzer', async () => {
      const st = useFoxtrotStore().getState();

      if (!(st.activeEDA && st.activePart && st.activeFuzzer)) {
        vscode.window.showWarningMessage('Select EDA, part and fuzzer first (BitGen sidebar).');
        return;
      }

      await ctx.workspaceState.update('runInProgress', true);
      await ctx.workspaceState.update('runStartedAt', Date.now());
      void vscode.commands.executeCommand('bitgenPanel.runStarted');

      const term = await spawnFoxtrotRun({ ctx, store: st });
      if (!term) {
        return;
      } // Error surfaced within `spawnFoxtrotRun`.

      const listener = vscode.window.onDidCloseTerminal(async closed => {
        if (closed !== term) {
          return;
        }

        const success = (closed.exitStatus?.code ?? 1) === 0;

        await ctx.workspaceState.update('runInProgress', false);
        await ctx.workspaceState.update('runStartedAt', undefined);
        void vscode.commands.executeCommand('bitgenPanel.runFinished', success);

        if (!success) {
          vscode.window.showErrorMessage('Foxtrot run failed – see terminal.');
        }

        listener.dispose();
      });

      ctx.subscriptions.push(listener);
    }),

    cmd('foxtrot.reinstallPackages', () => reinstallPackages(ctx)),
    cmd('foxtrot.bitmap.newAnalysis', () => createBitmapAnalysis(ctx))
  );
};

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

export const activate = async (ctx: vscode.ExtensionContext): Promise<void> => {
  /* ---------- Init state & register domains ---------- */
  await initState(ctx);
  await refreshContextKey();
  await registerDomains(ctx);
  switchPhase.register(ctx);

  /* ---------- UI ---------- */
  createActivePartStatusBar(ctx);

  /* ---------- Commands ---------- */
  registerCommands(ctx);

  /* ---------- Phase & bootstrap ---------- */
  await vscode.commands.executeCommand('setContext', 'viewPhase', 'bitgen');
  await maybeBootstrapWorkspace(ctx);

  /* ---------- Workspace listeners ---------- */
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await refreshContextKey();
      await maybeBootstrapWorkspace(ctx);
    })
  );
};

export const deactivate = (): void => {
  /* Nothing to clean up – disposables are handled via `ctx.subscriptions`. */
};
