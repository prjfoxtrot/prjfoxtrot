/**
 * Reinstall all Python packages required by Foxtrot in the current workspace.
 *
 * Steps:
 * 1. Verify the workspace has been initialised ('.foxtrot-init' marker).
 * 2. Ensure a virtual environment exists (create if missing).
 * 3. Force-reinstall bundled wheels shipped with the extension.
 * 4. Force-reinstall workspace-specific requirements.txt (if present).
 *
 * On success, shows a VS Code information message.
 * On failure, shows a VS Code error message.
 * @param ctx VS Code extension context.
 */

import * as path from 'path';
import * as vscode from 'vscode';

import fs from 'fs-extra';

import {
  ensureVenv,
  pipInstall,
  pipInstallWheels,
  uriExists,
  pipInstallGithubWheels,
} from '../utils/pythonUtils';

/**
 *
 */
export async function reinstallPackages(ctx: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    // No folder open – nothing to do.
    return;
  }

  const wsDir = workspaceFolder.uri.fsPath;
  const initMarker = vscode.Uri.joinPath(workspaceFolder.uri, '.foxtrot-init');

  // Guard: workspace must be initialised first.
  if (!(await uriExists(initMarker))) {
    void vscode.window.showWarningMessage(
      'Workspace hasn\u2019t been initialised – run “Foxtrot: New Workspace” first.'
    );
    return;
  }

  try {
    /* 1 ▸ ensure virtual-env */
    const venvDir = await ensureVenv(wsDir);
    const pipExe =
      process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'pip.exe')
        : path.join(venvDir, 'bin', 'pip');

    /* 2 ▸ reinstall wheels from GitHub (force) */
    await pipInstallGithubWheels(pipExe);

    /* 3 ▸ reinstall bundled wheels */
    const bundledWheelsDir = path.join(ctx.extensionPath, 'plugins-bundled');
    await pipInstallWheels(pipExe, bundledWheelsDir, true /* force */);

    /* 4 ▸ reinstall workspace requirements (if any) */
    const requirementsTxt = path.join(wsDir, 'requirements.txt');
    if (await fs.pathExists(requirementsTxt)) {
      await pipInstall(
        pipExe,
        ['install', '--force-reinstall', '-r', requirementsTxt],
        'Reinstalling workspace requirements…'
      );
    }

    void vscode.window.showInformationMessage('Foxtrot packages reinstalled — all set 🦊📦');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Reinstall packages failed: ${message}`);
  }
}
