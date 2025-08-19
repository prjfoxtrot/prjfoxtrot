/**
 * Bootstraps the current Foxtrot workspace.
 *
 * Process:
 * 1. Ensure a local Python virtual-environment exists (create one if necessary).
 * 2. Prompt user and install wheels from GitHub or plugins-bundled.
 * 3. Persist the interpreter path to `.vscode/settings.json` (merged, not clobbered).
 * 4. Set the `foxtrot.isInitialised` context key and refresh store.
 */

import * as vscode from 'vscode';

import { reloadPersistedState } from '../app/state';
import { promptAndInstall } from '../utils/installers';
import { ensureVenv, uriExists, venvExe } from '../utils/pythonUtils';

/**
 * Bootstraps the currently opened workspace (first folder in a multi-root setup).
 * @param {vscode.ExtensionContext} context VS Code extension context for scoped operations (secrets, storage, etc.)
 */
export async function bootstrapWorkspace(context: vscode.ExtensionContext): Promise<void> {
  // Work only on the first (primary) workspace folder
  const [workspaceFolder] = vscode.workspace.workspaceFolders ?? [];
  if (!workspaceFolder) {
    return;
  }

  const workspaceUri = workspaceFolder.uri;
  const workspaceDir = workspaceUri.fsPath;
  const initMarkerUri = vscode.Uri.joinPath(workspaceUri, '.foxtrot-init');

  // Abort if the skeleton has not been copied yet.
  if (!(await uriExists(initMarkerUri))) {
    void vscode.window.showWarningMessage(
      'Folder has not been initialised — run "Foxtrot: New Workspace" first.'
    );
    return;
  }

  try {
    // 1 ▸ ensure .venv
    const venvDir = await ensureVenv(workspaceDir);
    const pyExe = venvExe(venvDir, 'python');

    // 2 ▸ prompt + install (GitHub or bundled)
    await promptAndInstall({ context, workspaceUri });

    // 3 ▸ write interpreter path to settings.json (merge, do not clobber)
    await writeInterpreterSettings(workspaceUri, pyExe);

    // 4 ▸ ready!
    await vscode.commands.executeCommand('setContext', 'foxtrot.isInitialised', true);
    await reloadPersistedState();

    void vscode.window.showInformationMessage('Foxtrot workspace ready — happy hacking!');
  } catch (err) {
    // Log to Output channel instead of console.* in production
    const output = vscode.window.createOutputChannel('Foxtrot');
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    output.appendLine('[Foxtrot] bootstrapWorkspace failed:');
    output.appendLine(msg);

    await vscode.commands.executeCommand('setContext', 'foxtrot.isInitialised', false);
    void vscode.window.showErrorMessage(
      'Foxtrot workspace initialisation failed — see the "Foxtrot" Output channel for details.'
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Private helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Merge and persist Python interpreter settings into `.vscode/settings.json`.
 * Uses the VS Code FS API to support remote workspaces.
 */
async function writeInterpreterSettings(
  rootUri: vscode.Uri,
  interpreterPath: string
): Promise<void> {
  const vscodeDir = vscode.Uri.joinPath(rootUri, '.vscode');
  const settingsUri = vscode.Uri.joinPath(vscodeDir, 'settings.json');

  // Ensure `.vscode/` exists
  await vscode.workspace.fs.createDirectory(vscodeDir);

  // Read existing settings if present
  let existing: Record<string, unknown> = {};
  if (await uriExists(settingsUri)) {
    try {
      const raw = await vscode.workspace.fs.readFile(settingsUri);
      existing = JSON.parse(Buffer.from(raw).toString('utf8')) ?? {};
    } catch {
      // If parsing fails, treat as empty and overwrite below
      existing = {};
    }
  }

  // Merge keys (override just what we own)
  const merged = {
    ...existing,
    'python.defaultInterpreterPath': interpreterPath,
    'foxtrot.pythonPath': interpreterPath,
  };

  const settingsContent = JSON.stringify(merged, null, 2);
  await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(settingsContent, 'utf8'));
}
