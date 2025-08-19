/**
 * Foxtrot - createWorkspace
 * -------------------------
 * Generates a fresh Foxtrot workspace from the bundled template.
 *
 * Steps:
 * 1) Copy the `default-workspace` skeleton into a chosen destination.
 * 2) Create a Python virtual environment and install user-selected wheels (pre-reload).
 * 3) Optionally install `requirements.txt` found in the template.
 * 4) Write `.vscode/settings.json` to hint the Python interpreter for VS Code + Foxtrot.
 * 5) Reopen the folder in the current window and show a success toast.
 *
 * Long-running tasks run under `withProgress` with strong cancellation behavior.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';

import fs from 'fs-extra';

import { promptAndInstall } from '../utils/installers';
import { ensureVenv, pipInstall, venvExe } from '../utils/pythonUtils';

import { bootstrapWorkspace } from './bootstrapWorkspace';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PROGRESS_TITLE = 'Creating Foxtrot workspace…' as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sleep helper – resolves after the given milliseconds.
 * @param {number} ms Milliseconds to wait.
 */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Throw a `CancellationError` if the token was cancelled.
 * Call this before/after expensive steps to fail fast and avoid partial writes.
 */
function ensureNotCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}

/**
 * Write `.vscode/settings.json` so the Python extension auto-detects
 * the correct interpreter for both Foxtrot and the Python extension.
 * @param {string} wsDir Absolute path to the workspace directory.
 * @param {string} pythonPath Absolute path to the Python interpreter inside the venv.
 */
async function writeInterpreterSettings(wsDir: string, pythonPath: string): Promise<void> {
  const vscodeDir = vscode.Uri.file(path.join(wsDir, '.vscode'));
  const settingsUri = vscode.Uri.file(path.join(wsDir, '.vscode', 'settings.json'));

  await vscode.workspace.fs.createDirectory(vscodeDir);
  const content = JSON.stringify(
    {
      // VS Code Python extension interpreter discovery:
      'python.defaultInterpreterPath': pythonPath,
      // Foxtrot-specific consumers:
      'foxtrot.pythonPath': pythonPath,
    },
    null,
    2
  );
  await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(content));
}

/**
 * Copy the template skeleton to the selected destination.
 * @param {string} templateDir Path to the bundled `default-workspace` directory.
 * @param {string} dstDir Destination directory chosen by the user.
 * @throws Error if the template folder is missing or destination has conflicting files.
 */
async function copyTemplate(templateDir: string, dstDir: string): Promise<void> {
  const exists = await fs.pathExists(templateDir);
  if (!exists) {
    throw new Error('Bundled workspace template not found. Please reinstall the extension.');
  }

  // Fail if files already exist to avoid clobbering user data.
  await fs.copy(templateDir, dstDir, {
    overwrite: false,
    errorOnExist: true,
    // Keep copy explicit; filter may be added here if we ever exclude files.
  });

  // Marker file to detect first-run bootstrap.
  await fs.ensureFile(path.join(dstDir, '.foxtrot-init'));
}

/**
 * Ensure the venv exists, run the wheel installer flow, and install optional requirements.
 * @param {vscode.ExtensionContext} ctx Extension context.
 * @param {vscode.Uri} workspaceUri Destination folder URI.
 * @param {vscode.CancellationToken} token Cancellation token to observe during long-running tasks.
 * @returns {Promise<string>} Absolute path to the Python executable inside the venv.
 */
async function setupPythonEnvironment(
  ctx: vscode.ExtensionContext,
  workspaceUri: vscode.Uri,
  token: vscode.CancellationToken
): Promise<string> {
  ensureNotCancelled(token);

  // Let the user choose/install from bundled or GitHub-provided wheels.
  await promptAndInstall({ context: ctx, workspaceUri });
  ensureNotCancelled(token);

  const dstDir = workspaceUri.fsPath;
  const venvDir = await ensureVenv(dstDir); // idempotent
  const pip = venvExe(venvDir, 'pip');

  const reqTxt = path.join(dstDir, 'requirements.txt');
  if (await fs.pathExists(reqTxt)) {
    await pipInstall(pip, ['install', '-r', reqTxt], 'Installing workspace requirements…');
  }

  ensureNotCancelled(token);
  return venvExe(venvDir, 'python');
}

/* -------------------------------------------------------------------------- */
/* Entry Point                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Command handler – create or initialise a Foxtrot workspace.
 *
 * Behavior:
 * - If a folder is already open, we only need to bootstrap the current workspace.
 * - Otherwise, prompt for a destination and scaffold a fresh workspace there.
 * @example
 *   await createWorkspace(context);
 */
export async function createWorkspace(ctx: vscode.ExtensionContext): Promise<void> {
  // When a folder is already open we only need to bootstrap.
  if (vscode.workspace.workspaceFolders?.length) {
    await bootstrapWorkspace(ctx);
    return;
  }

  // Ask the user where to create the new workspace.
  const selection = await vscode.window.showOpenDialog({
    title: 'Select destination folder',
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create here',
  });
  if (!selection?.length) {
    return; // user cancelled the picker
  }

  const dstUri = selection[0];
  const dstDir = dstUri.fsPath;
  const templateDir = path.join(ctx.extensionPath, 'default-workspace');

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: PROGRESS_TITLE, cancellable: true },
      async (progress, token) => {
        progress.report({ message: 'Copying template…' });
        await copyTemplate(templateDir, dstDir);
        ensureNotCancelled(token);

        progress.report({ message: 'Setting up Python environment…' });
        const pythonExe = await setupPythonEnvironment(ctx, dstUri, token);

        progress.report({ message: 'Writing workspace settings…' });
        await writeInterpreterSettings(dstDir, pythonExe);
        ensureNotCancelled(token);
      }
    );

    // Friendly toast & open folder after progress completes successfully.
    void vscode.window.showInformationMessage('Foxtrot workspace ready — opening it now');
    await delay(800); // brief pause to let the toast render nicely
    await vscode.commands.executeCommand('vscode.openFolder', dstUri, false);
  } catch (err) {
    // Do not treat cancellations as failures/noise.
    if (err instanceof vscode.CancellationError) {
      return;
    }

    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Create workspace failed: ${msg}`);
  }
}
