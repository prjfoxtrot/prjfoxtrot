/**
 * spawnFoxtrotRun
 * ---------------
 * Launches `foxtrot_core.cli run` inside a dedicated VS Code integrated
 * terminal named **"Foxtrot run"**.
 *
 * A temporary TOML override reflecting the current UI selections is written
 * to the extension `storageUri` (or `.vscode/` in the workspace) so that
 * Foxtrot can read the state without mutating project files.
 *
 * The terminal closes automatically on successful completion and the created
 * {@link vscode.Terminal} is returned so callers can hook
 * `onDidCloseTerminal` to track exit status.
 * @module spawnFoxtrotRun
 */

import * as path from 'path';
import * as vscode from 'vscode';

import { stringify as tomlStringify } from '@iarna/toml';
import fs from 'fs-extra';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface FoxtrotSelectionState {
  /** Last-selected EDA plugin (`null` when none is selected). */
  activePlugin: string | null;
  /** Last-selected FPGA part (`null` when none is selected). */
  activePart: string | null;
  /** Last-selected fuzzer (`null` when none is selected). */
  activeFuzzer: string | null;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const TERMINAL_NAME = 'Foxtrot run';
const OVERRIDE_PREFIX = 'override-';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Serialises the UI state into an override TOML string.
 * @param {FoxtrotSelectionState} selection - The current selection snapshot.
 * @returns {string} TOML representation of the selection.
 */
function buildOverrideToml(selection: FoxtrotSelectionState): string {
  return tomlStringify({
    project: {
      plugin: selection.activePlugin ?? '',
      active_fuzzer: selection.activeFuzzer ?? '',
    },
    part: { active_fpga: selection.activePart ?? '' },
  });
}

/**
 * Persists the TOML override next to the workspace or in the extension
 * storage folder.
 * @param {vscode.Uri} dir - Target directory in which to write the file.
 * @param {string} toml - TOML string to write.
 * @returns {Promise<string>} Absolute path to the newly created file.
 */
async function writeOverrideFile(dir: vscode.Uri, toml: string): Promise<string> {
  await fs.ensureDir(dir.fsPath);
  const filePath = path.join(dir.fsPath, `${OVERRIDE_PREFIX}${Date.now()}.toml`);
  await fs.writeFile(filePath, toml, 'utf8');
  return filePath;
}

/**
 * Converts a command-array into a shell line that exits the terminal on
 * success while preserving the numeric exit status.
 * @param {string[]} cmd - Command and arguments.
 * @returns {string} Shell-ready command line string.
 */
function toShellLine(cmd: string[]): string {
  const joined = cmd.join(' ');
  if (process.platform === 'win32') {
    // PowerShell (default on Windows): $LASTEXITCODE propagates the exit code
    return `${joined}; if ($LASTEXITCODE -eq 0) { exit }`;
  }
  // POSIX shells & cmd.exe understand `&& exit`
  return `${joined} && exit`;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Launch Foxtrot with UI-derived overrides in a new integrated terminal.
 * @param {object} params - Function parameters.
 * @param {vscode.ExtensionContext} params.ctx - Extension context for storage resolution.
 * @param {FoxtrotSelectionState} params.store - Selection snapshot (plugin, fuzzer, FPGA part).
 * @returns {Promise<vscode.Terminal | void>} The spawned terminal instance, or void if no workspace is open.
 */
export async function spawnFoxtrotRun({
  ctx,
  store,
}: {
  ctx: vscode.ExtensionContext;
  store: FoxtrotSelectionState;
}): Promise<vscode.Terminal | void> {
  /* Workspace guard */
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    vscode.window.showErrorMessage('Open a Foxtrot workspace first.');
    return;
  }

  /* 1 ▸ Build override TOML & persist it */
  const overrideToml = buildOverrideToml(store);
  const storageDir = ctx.storageUri ?? vscode.Uri.joinPath(workspace.uri, '.vscode');
  const overrideFile = await writeOverrideFile(storageDir, overrideToml);

  /* 2 ▸ Compose CLI command line */
  const pythonPath = vscode.workspace
    .getConfiguration('foxtrot')
    .get<string>('pythonPath', 'python');

  // Quote paths to survive spaces on Windows (e.g. "Program Files")
  const cmd: string[] = [
    `"${pythonPath}"`,
    '-m',
    'foxtrot_core.cli',
    'run',
    '--workspace',
    `"${workspace.uri.fsPath}"`,
    '--override',
    `"${overrideFile}"`,
  ];

  /* 3 ▸ Spawn integrated terminal */
  const terminal = vscode.window.createTerminal({ name: TERMINAL_NAME });
  terminal.show();
  terminal.sendText(toShellLine(cmd));

  return terminal;
}
