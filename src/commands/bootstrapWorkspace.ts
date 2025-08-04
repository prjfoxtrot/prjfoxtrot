/**
 * Bootstraps the current Foxtrot workspace.
 *
 * **Process overview**
 * 1. Ensure a local Python virtual-environment exists (create one if necessary).
 * 2. Install the Python wheel files bundled with the extension.
 * 3. Persist the venv interpreter path to `.vscode/settings.json` so VS Code's
 * Python extension (and Foxtrot itself) pick it up automatically.
 * 4. Set the `foxtrot.isInitialised` context key and refresh the internal store.
 *
 * The command aborts early if the workspace has not been initialised by
 * **Foxtrot: New Workspace** yet (marker file `.foxtrot-init` is missing).
 * @param {vscode.ExtensionContext} ctx Extension context provided by VS Code on activation.
 */

import * as path from 'path';
import * as vscode from 'vscode';

import fs from 'fs-extra';

import { reloadPersistedState } from '../app/state';
import {
  ensureVenv,
  pipInstallWheels,
  uriExists,
  pipInstallGithubWheels,
} from '../utils/pythonUtils';

/**
 *
 */
export async function bootstrapWorkspace(ctx: vscode.ExtensionContext): Promise<void> {
  // Work only on the first (primary) workspace folder
  const [workspaceFolder] = vscode.workspace.workspaceFolders ?? [];
  if (!workspaceFolder) {
    return;
  }

  const workspaceDir = workspaceFolder.uri.fsPath;
  const initMarkerUri = vscode.Uri.joinPath(workspaceFolder.uri, '.foxtrot-init');

  // ──────────────────────────────────────────────────────────────
  // Abort if the skeleton has not been copied yet.
  // ──────────────────────────────────────────────────────────────
  if (!(await uriExists(initMarkerUri))) {
    void vscode.window.showWarningMessage(
      'Folder has not been initialised - run "Foxtrot: New Workspace" first.'
    );
    return;
  }

  try {
    // 1 ▸ ensure .venv
    const venvDir = await ensureVenv(workspaceDir);
    const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
    const pipExe = path.join(venvDir, binDir, process.platform === 'win32' ? 'pip.exe' : 'pip');
    const pyExe = path.join(
      venvDir,
      binDir,
      process.platform === 'win32' ? 'python.exe' : 'python'
    );

    // 2 ▸ install latest wheels from GitHub (best effort)
    await pipInstallGithubWheels(pipExe);

    // 3 ▸ install any *additional* wheels bundled with the extension
    const wheelsDir = path.join(ctx.extensionPath, 'plugins-bundled');
    await pipInstallWheels(pipExe, wheelsDir);

    // 4 ▸ write interpreter path to settings.json
    const settingsUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'settings.json');
    await fs.ensureDir(path.dirname(settingsUri.fsPath));

    const settingsContent = JSON.stringify(
      {
        'python.defaultInterpreterPath': pyExe,
        'foxtrot.pythonPath': pyExe,
      },
      null,
      2
    );

    await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(settingsContent));

    // 4 ▸ ready!
    await vscode.commands.executeCommand('setContext', 'foxtrot.isInitialised', true);
    await reloadPersistedState();

    void vscode.window.showInformationMessage('Foxtrot workspace ready — happy hacking 🦊🐾');
  } catch (err) {
    console.error('[Foxtrot] bootstrapWorkspace failed:', err);
    await vscode.commands.executeCommand('setContext', 'foxtrot.isInitialised', false);
    void vscode.window.showErrorMessage(
      'Foxtrot workspace initialisation failed — see console for details.'
    );
  }
}
