/**
 * Foxtrot - *createWorkspace*
 * ---------------------------------------------
 * Generates a fresh Foxtrot workspace based on the bundled template:
 *
 * 1.  Copies the `default-workspace` skeleton into an existing/open folder or a
 *     user-chosen destination.
 * 2.  Creates a Python virtual-environment and installs the bundled wheels
 *     **before** the window reload (ensures the Python extension can index).
 * 3.  Installs additional dependencies from an optional `requirements.txt` in
 *     the template.
 * 4.  Writes `.vscode/settings.json` to hint the Python interpreter for both
 *     Foxtrot and the VS Code Python extension.
 * 5.  Re-opens the folder in the current window and shows a friendly toast.
 *
 * Long-running tasks (file copy & package install) are wrapped in
 * `withProgress` so the user sees feedback and can cancel if necessary.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';

import fs from 'fs-extra';

import {
  ensureVenv,
  pipInstall,
  pipInstallWheels,
  pipInstallGithubWheels,
} from '../utils/pythonUtils';

import { bootstrapWorkspace } from './bootstrapWorkspace';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Sleep helper – resolves after the given milliseconds. */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Return the absolute path to an executable inside *venvDir*. */
function venvExe(venvDir: string, exe: 'python' | 'pip'): string {
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return path.join(venvDir, bin, `${exe}${suffix}`);
}

/**
 * Write `.vscode/settings.json` so the Python extension auto-detects
 * the correct interpreter.
 */
async function writeInterpreter(wsDir: string, pythonPath: string): Promise<void> {
  const cfgUri = vscode.Uri.file(path.join(wsDir, '.vscode', 'settings.json'));
  await fs.ensureDir(path.dirname(cfgUri.fsPath));
  const content = JSON.stringify(
    {
      'python.defaultInterpreterPath': pythonPath,
      'foxtrot.pythonPath': pythonPath,
    },
    null,
    2
  );
  await vscode.workspace.fs.writeFile(cfgUri, Buffer.from(content));
}

/* -------------------------------------------------------------------------- */
/* Entry Point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Command handler – create or initialise a Foxtrot workspace.
 */
export async function createWorkspace(ctx: vscode.ExtensionContext): Promise<void> {
  // When a folder is **already** open we only need to bootstrap.
  if (vscode.workspace.workspaceFolders?.length) {
    await bootstrapWorkspace(ctx);
    return;
  }

  /* ---------------------------------------------------------------------- */
  /* Ask the user where to create the new workspace                         */
  /* ---------------------------------------------------------------------- */

  const selection = await vscode.window.showOpenDialog({
    title: 'Select destination folder',
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Create here',
  });
  if (!selection?.length) {
    return;
  } // user cancelled

  const dstUri = selection[0];
  const dstDir = dstUri.fsPath;
  const tplDir = path.join(ctx.extensionPath, 'default-workspace');
  const wheelsDir = path.join(ctx.extensionPath, 'plugins-bundled');

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Creating Foxtrot workspace…',
        cancellable: true,
      },
      async (progress, token) => {
        /* 1 ▸ Copy template -------------------------------------------------- */
        progress.report({ message: 'Copying template…' });
        await fs.copy(tplDir, dstDir, {
          overwrite: false,
          errorOnExist: true,
        });
        await fs.ensureFile(path.join(dstDir, '.foxtrot-init'));

        if (token.isCancellationRequested) {
          return;
        }

        /* 2 ▸ Create virtual-environment & install deps -------------------- */
        progress.report({ message: 'Creating virtual-environment…' });
        const venvDir = await ensureVenv(dstDir);
        const pipExe = venvExe(venvDir, 'pip');

        progress.report({ message: 'Installing wheels from GitHub…' });
        await pipInstallGithubWheels(pipExe);

        progress.report({ message: 'Installing bundled wheels…' });
        await pipInstallWheels(pipExe, wheelsDir);

        const reqTxt = path.join(dstDir, 'requirements.txt');
        if (await fs.pathExists(reqTxt)) {
          progress.report({ message: 'Installing workspace requirements…' });
          await pipInstall(pipExe, ['install', '-r', reqTxt], 'Installing workspace requirements…');
        }

        if (token.isCancellationRequested) {
          return;
        }

        /* 3 ▸ Hint interpreter to Python extension ------------------------- */
        const pyExe = venvExe(venvDir, 'python');
        await writeInterpreter(dstDir, pyExe);
      }
    );

    /* 4 ▸ Friendly toast & open folder -------------------------------------- */
    void vscode.window.showInformationMessage('Foxtrot workspace ready — opening it now 🦊🐾');
    await delay(1200); // allow time for the toast to render

    await vscode.commands.executeCommand('vscode.openFolder', dstUri, false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Create workspace failed: ${msg}`);
  }
}
