/**
 * pythonUtils.ts
 * --------------
 * Minimal runtime utilities for the Foxtrot VS Code extension:
 *
 * • create / reuse a per-workspace virtual environment (`ensureVenv`);
 * • run pip with progress + streaming logs (`pipInstall`);
 * • tiny fs helper (`uriExists`);
 * • compute venv executables (`venvExe`).
 *
 * Wheel source selection (GitHub vs plugins-bundled) is handled in
 * src/utils/installers.ts.
 *
 * Runtime deps: Node ≥ 20 + VS Code API.
 */

import * as cp from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';

const exec = promisify(cp.exec);
const outputChannel = vscode.window.createOutputChannel('Foxtrot');

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Run a shell command in optional cwd, returning stdout/stderr. */
async function runCommand(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return exec(cmd, { cwd });
}

/** True iff the given {@link vscode.Uri} exists on disk. */
export async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Return the absolute path to an executable inside `venvDir`. */
export function venvExe(venvDir: string, exe: 'python' | 'pip'): string {
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return path.join(venvDir, bin, `${exe}${suffix}`);
}

/* -------------------------------------------------------------------------- */
/* Python interpreter resolution                                              */
/* -------------------------------------------------------------------------- */

const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);

/** Probe that a python command can run and import sys. */
async function probePython(cmd: string): Promise<boolean> {
  try {
    await exec(`${cmd} -c "import sys;print(sys.version)"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a Python executable to create the venv with.
 * Order:
 *  1) configured path (foxtrot.pythonPath)
 *  2) Windows: `py -3`, then `python`
 *  3) POSIX: `python3`, then `python`
 */
async function resolvePythonExecutable(configured?: string): Promise<string> {
  if (configured) {
    const cmd = quote(configured);
    if (await probePython(cmd)) {
      return cmd;
    }
  }

  if (process.platform === 'win32') {
    if (await probePython('py -3')) {
      return 'py -3';
    }
    if (await probePython('python')) {
      return 'python';
    }
  } else {
    if (await probePython('python3')) {
      return 'python3';
    }
    if (await probePython('python')) {
      return 'python';
    }
  }

  throw new Error(
    'No suitable Python interpreter found. Install Python 3.10+ or set “foxtrot.pythonPath”.'
  );
}

/* -------------------------------------------------------------------------- */
/* Virtual-environment bootstrap                                              */
/* -------------------------------------------------------------------------- */

/**
 * Ensure a .venv exists under `workspaceDir` and return its directory path.
 * If `pythonLauncher` is provided (e.g., from `foxtrot.pythonPath`), it will be
 * considered first; otherwise we auto-detect a suitable interpreter.
 * Idempotent: if the interpreter already exists, nothing is created.
 */
export async function ensureVenv(workspaceDir: string, pythonLauncher?: string): Promise<string> {
  const venvDir = path.join(workspaceDir, '.venv');
  const pyExe = venvExe(venvDir, 'python');

  if (await uriExists(vscode.Uri.file(pyExe))) {
    // Reuse existing environment
    return venvDir;
  }

  const launcher = await resolvePythonExecutable(pythonLauncher?.trim() || undefined);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Creating virtual environment…' },
    async () => {
      await runCommand(`${launcher} -m venv .venv`, workspaceDir);
    }
  );

  return venvDir;
}

/* -------------------------------------------------------------------------- */
/* pip wrapper                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Run pip with a progress notification and stream output to the Foxtrot channel.
 * Throws on non-zero exit.
 * @param {string} pipExe Absolute path to pip inside the venv.
 * @param {string[]} args   Arguments to pass to pip (e.g., ['install','-r','requirements.txt']).
 * @param {string} [title]  Optional progress title.
 */
export async function pipInstall(
  pipExe: string,
  args: string[],
  title = 'Running pip…'
): Promise<void> {
  const cmd = `"${pipExe}" ${args.map(quote).join(' ')}`;
  const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title },
    async () => {
      try {
        const { stdout, stderr } = await runCommand(cmd, wsDir);
        outputChannel.appendLine(`\n[pip] ${cmd}`);
        if (stdout) {
          outputChannel.append(stdout);
        }
        if (stderr) {
          outputChannel.append(stderr);
        }
      } catch (err) {
        const stderr = extractExecStderr(err);
        outputChannel.appendLine(`\n[pip-error] ${cmd}`);
        outputChannel.append(stderr);
        outputChannel.show(true);
        throw new Error(stderr);
      }
    }
  );
}

/**
 *
 */
function extractExecStderr(err: unknown): string {
  if (
    typeof err === 'object' &&
    err &&
    'stderr' in err &&
    typeof (err as { stderr?: unknown }).stderr === 'string'
  ) {
    return (err as { stderr: string }).stderr;
  }
  return err instanceof Error ? err.message : String(err);
}
