/**
 * spawnFoxtrotRun
 * ---------------
 * Launches `python -m foxtrot_core bitgen run` inside a dedicated VS Code
 * integrated terminal named "Foxtrot run".
 *
 * This version intentionally DOES NOT write or pass a TOML override.
 * It relies on the project's own configuration files (e.g. `project_settings.toml`).
 *
 * Security: validates the configured Python interpreter path to avoid shell
 * injection, quotes paths, and limits shell-specific auto-exit logic to
 * platform defaults (PowerShell on Windows; POSIX/cmd elsewhere).
 *
 * Behavior: if a terminal with the same name already exists, it is reused to
 * avoid clutter. The terminal will auto-close on success.
 * @module spawnFoxtrotRun
 */

import * as vscode from 'vscode';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Snapshot of the user's EDA/part/fuzzer selections.
 *
 * Note: The run operation no longer serializes these into an override; the
 * values are kept here for API compatibility with existing callers. Callers
 * should continue to persist selections to project settings elsewhere in the
 * extension (e.g., when the user makes a choice), so the Python toolchain can
 * read them directly.
 */
export interface FoxtrotSelectionState {
  /** Last-selected EDA profile dir (e.g. "edas/quartus/ii90") or null. */
  activeEDA: string | null;
  /** Last-selected FPGA part dir (e.g. "parts/amd/artix7/XC7A100TCSG324") or null. */
  activePart: string | null;
  /** Last-selected fuzzer (`null` when none is selected). */
  activeFuzzer: string | null;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const TERMINAL_NAME = 'Foxtrot run';
const CONFIG_SECTION = 'foxtrot' as const;
const CONFIG_PYTHON_PATH_KEY = 'pythonPath' as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Return the first workspace folder (Foxtrot is assumed single-root).
 */
function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Very conservative validation for an executable path coming from user config.
 *
 * Strips surrounding quotes and rejects common shell metacharacters to avoid
 * command injection when we later form a shell line.
 * @param {string} raw - Raw value from configuration.
 * @returns {string | null} sanitized path, or `null` if invalid.
 */
function sanitizeExecutablePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  // Disallow shell control chars that could chain extra commands.
  if (/[;&|`>\r\n]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Wrap a string in double quotes. Reserved characters are not expected in
 * workspace paths; we purposely avoid escaping beyond quotes for simplicity.
 */
function dq(value: string): string {
  return `"${value}"`;
}

/**
 * Converts a command-array into a shell line that exits the terminal on
 * success while preserving the numeric exit status.
 *
 * On Windows we assume PowerShell (the default integrated shell) and use
 * `$LASTEXITCODE`. Otherwise we rely on `&& exit` supported by POSIX shells
 * and cmd.exe. If a user has configured a different Windows shell, this may
 * not auto-close — the command still runs correctly.
 * @param {string[]} cmd - Command and arguments (each already quoted as needed).
 * @returns {string} Shell-ready command line string.
 */
function toShellLine(cmd: string[]): string {
  const joined = cmd.join(' ');
  if (process.platform === 'win32') {
    // PowerShell: `$LASTEXITCODE` propagates the exit code of the last native cmd.
    return `${joined}; if ($LASTEXITCODE -eq 0) { exit }`;
  }
  // POSIX shells & cmd.exe: only exit on success
  return `${joined} && exit`;
}

/**
 * Reuse an existing terminal by name, or create a new one.
 */
function getOrCreateTerminal(name: string, cwd?: string): vscode.Terminal {
  const existing = vscode.window.terminals.find(t => t.name === name);
  if (existing) {
    return existing;
  }
  return vscode.window.createTerminal({ name, cwd });
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Launch Foxtrot in a new (or existing) integrated terminal without using a TOML override.
 *
 * The Python command executed is:
 * `python -m foxtrot_core bitgen run --workspace "<workspace path>"`
 *
 * The Python interpreter path is read from the `foxtrot.pythonPath` setting,
 * defaulting to `python`. If you want to use a specific virtual environment,
 * point that setting at the desired interpreter (e.g.
 * `<repo>/.venv/bin/python` on POSIX or `<repo>\\.venv\\Scripts\\python.exe` on Windows).
 * @param {{ctx: vscode.ExtensionContext; store: FoxtrotSelectionState}} _params - Function parameters.
 * @param {vscode.ExtensionContext} _params.ctx - VS Code extension context (kept for API compatibility).
 * @param {FoxtrotSelectionState} _params.store - Selection snapshot (kept for API compatibility).
 * @returns {Promise<vscode.Terminal | void>} The spawned (or reused) terminal instance, or void if no workspace is open.
 */
export async function spawnFoxtrotRun(_params: {
  ctx: vscode.ExtensionContext;
  store: FoxtrotSelectionState;
}): Promise<vscode.Terminal | void> {
  // Workspace guard
  const workspace = getWorkspaceFolder();
  if (!workspace) {
    vscode.window.showErrorMessage('Open a Foxtrot workspace first.');
    return;
  }

  // Resolve and validate pythonPath from workspace-scoped configuration
  const configured = vscode.workspace
    .getConfiguration(CONFIG_SECTION, workspace.uri)
    .get<string>(CONFIG_PYTHON_PATH_KEY, 'python');

  const pythonExec = sanitizeExecutablePath(configured);
  if (!pythonExec) {
    vscode.window.showErrorMessage(
      `Invalid ${CONFIG_SECTION}.${CONFIG_PYTHON_PATH_KEY} setting: disallowed characters present.`
    );
    return;
  }

  // Compose CLI command line (quote paths to survive spaces)
  const cmd: string[] = [
    dq(pythonExec),
    '-m',
    'foxtrot_core',
    'bitgen',
    'run',
    '--workspace',
    dq(workspace.uri.fsPath),
  ];

  // Spawn or reuse integrated terminal, set CWD to the workspace root
  const terminal = getOrCreateTerminal(TERMINAL_NAME, workspace.uri.fsPath);
  terminal.show();
  terminal.sendText(toShellLine(cmd));

  return terminal;
}
