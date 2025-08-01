/**
 * pythonUtils.ts
 * --------------
 * Minimal runtime utilities that let the Foxtrot VS Code extension
 *
 * • detect a CUDA-capable GPU (`hasCudaGpu`);
 * • create / reuse a per-workspace virtual-environment (`ensureVenv`);
 * • install Foxtrot wheels
 *      ─ online: latest wheels from GitHub releases;
 *      ─ offline: fallback wheels bundled inside *plugins-bundled/*;
 * • run *pip* under a VS Code progress notification (`pipInstall`).
 *
 * **Runtime deps** Node ≥ 20 (global `fetch`) and the VS Code API only.
 */

import * as cp from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import * as vscode from 'vscode';

import fs from 'fs-extra';

const exec = promisify(cp.exec);
const outputChannel = vscode.window.createOutputChannel('Foxtrot');
const GITHUB_OWNER = 'prjfoxtrot'; // user or org – works for both
const ANALYSIS_EXTRAS = 'analysis'; // core CPU analytics extras

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** Tiny wrapper so every child-process call goes through the same funnel. */
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

/* -------------------------------------------------------------------------- */
/* GPU detection                                                              */
/* -------------------------------------------------------------------------- */

/** Quick probe for a CUDA-capable NVIDIA GPU. */
export function hasCudaGpu(): boolean {
  try {
    cp.execSync('nvidia-smi -L', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Virtual-environment bootstrap                                              */
/* -------------------------------------------------------------------------- */

/**
 *
 */
export async function ensureVenv(workspaceDir: string): Promise<string> {
  const venvDir = path.join(workspaceDir, '.venv');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const pyExe =
    process.platform === 'win32'
      ? path.join(venvDir, 'Scripts', 'python.exe')
      : path.join(venvDir, 'bin', 'python');

  if (await uriExists(vscode.Uri.file(pyExe))) {
    void vscode.window.showInformationMessage('Foxtrot: Using existing virtual environment.');
    return venvDir;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Creating virtual environment…' },
    () => runCommand(`${python} -m venv .venv`, workspaceDir)
  );

  return venvDir;
}

/* -------------------------------------------------------------------------- */
/* pip wrapper                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Run *pip* with progress feedback and stream stdout/stderr to the Foxtrot
 * output channel. Throws on non-zero exit.
 */
export async function pipInstall(
  pipExe: string,
  args: string[],
  title = 'Running pip…'
): Promise<void> {
  const quote = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);
  const cmd = `"${pipExe}" ${args.map(quote).join(' ')}`;
  const wsDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title },
    async () => {
      try {
        const { stdout, stderr } = await runCommand(cmd, wsDir);
        outputChannel.appendLine(`\n[pip] ${cmd}`);
        outputChannel.append(stdout);
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

/* -------------------------------------------------------------------------- */
/* GitHub-hosted wheel installer                                              */
/* -------------------------------------------------------------------------- */

let cachedRepoNames: string[] | null = null;

/** Fetch repo list once per session (org → user fallback). */
async function fetchFoxtrotRepos(): Promise<string[]> {
  if (cachedRepoNames) {
    return cachedRepoNames;
  }

  const token = process.env.GITHUB_TOKEN?.trim();
  const endpoints = [
    `https://api.github.com/orgs/${GITHUB_OWNER}/repos?per_page=100`,
    `https://api.github.com/users/${GITHUB_OWNER}/repos?per_page=100`,
  ];

  for (const url of endpoints) {
    try {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(url, {
        headers,
      });
      if (res.ok) {
        cachedRepoNames = ((await res.json()) as { name: string }[]).map(r => r.name);
        return cachedRepoNames;
      }
      if (res.status !== 404) {
        console.warn(`[Foxtrot] GitHub API ${res.status}: ${res.statusText}`);
        break;
      }
    } catch {
      /* network error – try next endpoint */
    }
  }
  console.warn('[Foxtrot] Unable to list GitHub repos – offline?');
  return [];
}

/**
 * Return PEP 508 requirement only when the wheel URL exists.
 * @param {string} specLeft  e.g. `"foxtrot-core[analysis]"`
 * @param {string} url       Absolute URL to the wheel
 */
async function wheelSpecIfAvailable(specLeft: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) {
      return `${specLeft} @ ${url}`;
    }
  } catch {
    /* network failure – treat as missing */
  }
  outputChannel.appendLine(`[Foxtrot] Wheel not found on GitHub: ${url}`);
  return null;
}

/**
 * Install every “0+latest” wheel available on GitHub.
 * Missing wheels or *pip* failures are logged but will **not** throw, enabling
 * the caller to continue with the bundled-wheel fallback.
 */
export async function pipInstallGithubWheels(pipExe: string): Promise<void> {
  const repos = await fetchFoxtrotRepos();
  if (repos.length === 0) {
    return;
  }

  const headPromises = repos
    .filter(name => name.startsWith('foxtrot-'))
    .map(async name => {
      const pkg = name; // pip name (hyphens kept)
      const wheel = `${name.replace(/-/g, '_')}-0+latest-py3-none-any.whl`;
      const url = `https://github.com/${GITHUB_OWNER}/${name}/releases/latest/download/${wheel}`;

      if (name === 'foxtrot-core') {
        let extras = ANALYSIS_EXTRAS;
        if (hasCudaGpu()) {
          const choice = await vscode.window.showQuickPick(
            ['Use GPU (RAPIDS cuML)', 'Stay on CPU'],
            {
              placeHolder: 'CUDA-capable GPU detected – choose backend',
            }
          );
          if (choice?.startsWith('Use GPU')) {
            extras += ',gpu';
          }
        }
        return wheelSpecIfAvailable(`${pkg}[${extras}]`, url);
      }

      return wheelSpecIfAvailable(pkg, url);
    });

  const specs = (await Promise.all(headPromises)).filter((s): s is string => Boolean(s));
  if (specs.length === 0) {
    return;
  }

  try {
    await pipInstall(
      pipExe,
      ['install', '--upgrade', ...specs],
      'Installing Foxtrot wheels from GitHub…'
    );
  } catch {
    outputChannel.appendLine(
      '[Foxtrot] GitHub wheel install failed — will fall back to bundled wheels.'
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Local wheel installer (plugins-bundled/)                                   */
/* -------------------------------------------------------------------------- */

/**
 *
 */
export async function pipInstallWheels(pipExe: string, dir: string, force = false): Promise<void> {
  if (!(await fs.pathExists(dir))) {
    console.warn(`[Foxtrot] plugins-bundled directory not found: ${dir}`);
    return;
  }

  const wheels = (await fs.readdir(dir))
    .filter(f => f.endsWith('.whl'))
    .map(f => path.join(dir, f));

  if (wheels.length === 0) {
    console.warn(`[Foxtrot] No wheels found in ${dir}`);
    return;
  }

  const coreWheel = wheels.find(w =>
    /foxtrot[-_]core-\d+\.\d+\.\d+.*\.whl$/i.test(path.basename(w))
  );

  const specs: string[] = [];
  if (coreWheel) {
    let extras = ANALYSIS_EXTRAS;
    if (hasCudaGpu()) {
      const choice = await vscode.window.showQuickPick(['Use GPU (RAPIDS cuML)', 'Stay on CPU'], {
        placeHolder: 'CUDA-capable GPU detected – choose backend',
      });
      if (choice?.startsWith('Use GPU')) {
        extras += ',gpu';
      }
    }
    specs.push(`foxtrot-core[${extras}] @ ${pathToFileURL(coreWheel)}`);
  }

  specs.push(...wheels.filter(w => w !== coreWheel));

  const args = ['install', '--upgrade', ...(force ? ['--force-reinstall'] : []), ...specs];
  await pipInstall(
    pipExe,
    args,
    force ? 'Re-installing Foxtrot wheels…' : 'Installing Foxtrot wheels…'
  );
}
