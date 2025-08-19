// src/utils/installers.ts
import * as cp from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { pipeline as streamPipeline } from 'stream';
import { promisify } from 'util';
import * as vscode from 'vscode';

import { ensureVenv, venvExe } from '../utils/pythonUtils';

type InstallSource = 'ask' | 'github' | 'bundled';

export interface InstallOpts {
  context: vscode.ExtensionContext;
  workspaceUri: vscode.Uri; // workspace root (where .venv lives)
}

const pipeline = promisify(streamPipeline);
const out = vscode.window.createOutputChannel('Foxtrot');

// Defaults/assumptions — adjust if you publish wheels to a different repo.
const OWNER = 'prjfoxtrot';
const OWNER_REPO = `${OWNER}/prjfoxtrot`;
const BASE_EXTRAS = 'analysis'; // for foxtrot-core extras

/* ────────────────────────────────────────────────────────────────────────── */
/* Entry: prompt + install                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 *
 */
export async function promptAndInstall(opts: InstallOpts): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('foxtrot');
  const pinned = (cfg.get<string>('installSource', 'ask') as InstallSource) || 'ask';
  const enablePicker = cfg.get<boolean>('enablePackagePicker', true);

  // Keep this setting name (it now means “attempt RAPIDS when on GPU”)
  const useNvidiaIdx = cfg.get<boolean>('useNvidiaIndexForGpu', true);
  const nvidiaIdxUrl = (
    cfg.get<string>('nvidiaExtraIndexUrl', 'https://pypi.nvidia.com') || ''
  ).trim();

  let source: InstallSource = pinned;
  if (pinned === 'ask') {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: 'GitHub (releases or HEAD)',
          detail: 'Prefer wheels from releases; fallback to git@HEAD',
          value: 'github',
        },
        {
          label: 'Local (plugins-bundled/)',
          detail: 'Use wheels packaged with the extension',
          value: 'bundled',
        },
      ],
      { title: 'Install Foxtrot packages from…', ignoreFocusOut: true, canPickMany: false }
    );
    if (!pick) {
      return;
    } // user cancelled
    source = pick.value as InstallSource;

    // Default to "ask each time" unless explicitly remembered
    const remember = await vscode.window.showQuickPick(
      [
        { label: 'Ask me each time', value: false },
        { label: 'Remember in this workspace', value: true },
      ],
      { title: 'Remember this choice?', ignoreFocusOut: true }
    );
    if (remember?.value) {
      await cfg.update('installSource', source, vscode.ConfigurationTarget.Workspace);
    }
  }

  const configuredPython = cfg.get<string>('pythonPath'); // may be undefined

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Foxtrot: Installing Python packages…',
    },
    async progress => {
      progress.report({ message: 'Preparing virtual environment…' });

      // Centralized venv creation + pathing
      const venvDir = await ensureVenv(opts.workspaceUri.fsPath, configuredPython);
      const venvPython = venvExe(venvDir, 'python');

      // Make sure pip tooling is up-to-date
      await execProcess(venvPython, [
        '-m',
        'pip',
        'install',
        '--upgrade',
        'pip',
        'setuptools',
        'wheel',
      ]);

      try {
        if (source === 'bundled') {
          await installFromBundled(opts.context, opts.workspaceUri, venvPython, progress);
        } else {
          try {
            // Try releases first; if that yields nothing, fallback to git@HEAD across repos.
            const foundAny = await installFromGitHub(
              opts.workspaceUri,
              venvPython,
              progress,
              enablePicker
            );
            if (!foundAny) {
              out.appendLine(
                '[Foxtrot] No wheel assets found in releases; falling back to GitHub repos (HEAD).'
              );
              await installFromGitHubReposHead(
                opts.workspaceUri,
                venvPython,
                progress,
                enablePicker,
                {
                  useNvidiaIdx,
                  nvidiaIdxUrl,
                }
              );
            }
          } catch (e) {
            const answer = await vscode.window.showWarningMessage(
              `GitHub install failed: ${(e as Error)?.message ?? e}. Install from local plugins-bundled/ instead?`,
              'Yes',
              'No'
            );
            if (answer === 'Yes') {
              await installFromBundled(opts.context, opts.workspaceUri, venvPython, progress);
            } else {
              throw e;
            }
          }
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Foxtrot install failed: ${(e as Error)?.message ?? e}`);
        throw e;
      }
    }
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Local install (plugins-bundled/)                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 *
 */
async function installFromBundled(
  context: vscode.ExtensionContext,
  workspaceUri: vscode.Uri,
  venvPython: string,
  progress: vscode.Progress<{ message?: string }>
) {
  const srcDirUri = vscode.Uri.joinPath(context.extensionUri, 'plugins-bundled');
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(srcDirUri);
  } catch {
    throw new Error('plugins-bundled/ is missing from this extension build.');
  }

  const wheels = entries
    .filter(e => e[1] === vscode.FileType.File && e[0].toLowerCase().endsWith('.whl'))
    .map(e => path.join(srcDirUri.fsPath, e[0]));

  if (wheels.length === 0) {
    throw new Error('No .whl files found under plugins-bundled/.');
  }

  progress.report({ message: `Installing ${wheels.length} local wheel(s)…` });

  for (const whl of wheels) {
    await execProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', whl], {
      cwd: workspaceUri.fsPath,
    });
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* GitHub install – Releases (scan multiple releases incl. prereleases)       */
/* Returns: true if any wheels were found & (attempted) installed.            */
/* ────────────────────────────────────────────────────────────────────────── */

type ReleaseWheel = { name: string; url: string; prerelease: boolean; publishedAt: string };

/**
 *
 */
async function installFromGitHub(
  workspaceUri: vscode.Uri,
  venvPython: string,
  progress: vscode.Progress<{ message?: string }>,
  enablePicker: boolean
): Promise<boolean> {
  progress.report({ message: 'Querying GitHub releases…' });

  // 1) Collect wheels across multiple releases (incl. prereleases)
  const allAssets = await fetchReleaseWheels(OWNER_REPO);
  if (allAssets.length === 0) {
    out.appendLine('[Foxtrot] No wheel assets found in releases.');
    return false;
  }

  // 2) Compute compatibility
  const pyTag = await detectCPTag(venvPython); // e.g., cp311
  const plats = platformWheelHints(); // e.g., ["manylinux", "musllinux", "linux"]
  const compatible = allAssets.filter(a => isWheelCompatible(a.name, pyTag, plats));

  // 3) Graceful fallback: if nothing matched, try any py3 wheel, then any wheel
  let usable = compatible;
  if (usable.length === 0) {
    const py3ish = allAssets.filter(a => /-py3[-_]|py3-none/.test(a.name.toLowerCase()));
    usable = py3ish.length ? py3ish : allAssets;
  }

  if (usable.length === 0) {
    logNoMatch(allAssets, pyTag, plats);
    return false;
  }

  // 4) Build a package list (dedupe by package name) and optionally show a picker
  const latestByPkg = pickLatestPerPackage(usable);
  let toInstall = latestByPkg;

  if (enablePicker) {
    const items: (vscode.QuickPickItem & { key: string; asset: ReleaseWheel })[] = latestByPkg.map(
      a => {
        const key = wheelPackageName(a.name);
        const isCore = isFoxtrotCorePkg(key);
        return {
          key,
          asset: a,
          label: isCore ? `$(zap) ${key}` : key,
          description: a.prerelease ? 'wheel · prerelease' : 'wheel',
          detail: a.name,
          picked: true,
        };
      }
    );

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      ignoreFocusOut: true,
      title: 'Select Foxtrot packages to install',
      placeHolder: 'Uncheck any plugins you don’t want to install now',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) {
      vscode.window.showInformationMessage('Install cancelled.');
      return true;
    }
    if (picked.length === 0) {
      vscode.window.showInformationMessage('Nothing selected — skipping install.');
      return true;
    }
    toInstall = picked.map(p => p.asset);
  }

  // 5) Download and install (core first if present)
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'foxtrot-wheels-'));

  // Core first
  const coreIdx = toInstall.findIndex(a => isFoxtrotCorePkg(wheelPackageName(a.name)));
  if (coreIdx > 0) {
    const [core] = toInstall.splice(coreIdx, 1);
    toInstall.unshift(core);
  }

  progress.report({ message: `Downloading ${toInstall.length} wheel(s)…` });

  const downloaded: string[] = [];
  for (const a of toInstall) {
    const dest = path.join(tmpDir, a.name);
    progress.report({ message: `Downloading ${a.name}…` });
    await downloadFile(a.url, dest); // ← working approach (handles redirects)
    downloaded.push(dest);
  }

  progress.report({ message: `Installing ${downloaded.length} wheel(s)…` });
  for (const whl of downloaded) {
    await execProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', whl], {
      cwd: workspaceUri.fsPath,
    });
  }

  return true;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* GitHub install – Fallback to git@HEAD across org/user repos                */
/* NOW with TensorFlow-only fallback button.                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 *
 */
async function installFromGitHubReposHead(
  workspaceUri: vscode.Uri,
  venvPython: string,
  progress: vscode.Progress<{ message?: string }>,
  enablePicker: boolean,
  opts: { useNvidiaIdx: boolean; nvidiaIdxUrl: string }
) {
  progress.report({ message: 'Fetching Foxtrot repo list…' });
  const repos = await fetchFoxtrotRepos(OWNER);

  if (!repos.length) {
    throw new Error('Could not enumerate GitHub repositories (org/user).');
  }

  // Candidate list = all foxtrot-* except template. Core pinned to top.
  const candidates = repos
    .filter(name => name.startsWith('foxtrot-') && name !== 'foxtrot-edaplugin-template')
    .sort((a, b) => (a === 'foxtrot-core' ? -1 : b === 'foxtrot-core' ? 1 : a.localeCompare(b)));

  let selected = candidates.slice();
  if (enablePicker) {
    const items = candidates.map(repo => ({
      label: repo === 'foxtrot-core' ? `$(zap) ${repo}` : repo,
      description: 'git@HEAD',
      detail: `Install latest from source (https://github.com/${OWNER}/${repo})`,
      picked: true,
      repo,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      ignoreFocusOut: true,
      title: 'Select Foxtrot packages to install (from GitHub HEAD)',
      placeHolder: 'Uncheck any plugins you don’t want to install now',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!picked) {
      vscode.window.showInformationMessage('Install cancelled.');
      return;
    }
    if (picked.length === 0) {
      vscode.window.showInformationMessage('Nothing selected — skipping install.');
      return;
    }
    selected = picked.map(p => p.repo);
  }

  // Ensure core first if selected
  const idx = selected.indexOf('foxtrot-core');
  if (idx > 0) {
    selected.splice(idx, 1);
    selected.unshift('foxtrot-core');
  }

  // Optional CPU/GPU extras for core
  let useGpu = false;
  if (selected[0] === 'foxtrot-core' && hasCudaGpu()) {
    const choice = await vscode.window.showQuickPick(
      [{ label: 'Use GPU (TensorFlow CUDA)' }, { label: 'Stay on CPU' }],
      { placeHolder: 'CUDA-capable GPU detected – choose backend' }
    );
    useGpu = !!choice && choice.label.startsWith('Use GPU');
  }

  // Build extras for foxtrot-core
  // GPU = TensorFlow[and-cuda]; RAPIDS added only when useNvidiaIdx=true
  let extras = `${BASE_EXTRAS},cpu`;
  if (useGpu) {
    const parts = [BASE_EXTRAS, 'gpu'];
    if (opts.useNvidiaIdx) {
      parts.push('rapids');
    }
    extras = parts.join(',');
  }

  for (const name of selected) {
    const baseArgs: string[] = ['-m', 'pip', 'install', '--upgrade'];

    if (name === 'foxtrot-core') {
      const addNvidiaIndex = useGpu && opts.useNvidiaIdx && opts.nvidiaIdxUrl;

      const argList = [...baseArgs];
      if (addNvidiaIndex) {
        argList.push('--extra-index-url', opts.nvidiaIdxUrl);
      }
      const spec = `foxtrot-core[${extras}]@git+https://github.com/${OWNER}/foxtrot-core.git`;
      argList.push(spec);

      out.appendLine(
        `[Foxtrot] pip install --upgrade ${addNvidiaIndex ? `--extra-index-url ${opts.nvidiaIdxUrl} ` : ''}${spec}`
      );

      progress.report({ message: `Installing ${name} (GitHub HEAD)…` });

      try {
        await execProcess(venvPython, argList, { cwd: workspaceUri.fsPath });
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);

        // If we failed on RAPIDS downloads or corporate blocking, offer fine-grained fallbacks.
        if (/(cuml|cuml-cu12|cudf|nvidia\.com|ExecutableDownloadsNew|403)/i.test(msg)) {
          const action = await vscode.window.showErrorMessage(
            'GPU install hit RAPIDS (cuml) downloads that look blocked/unreachable.',
            {
              modal: true,
              detail:
                'You can continue with TensorFlow-only (GPU), analysis-only, retry on CPU, or cancel.',
            },
            'TensorFlow Only (GPU)',
            'Analysis Only',
            'Retry on CPU'
          );

          if (action === 'TensorFlow Only (GPU)') {
            // Reinstall core with TF-only GPU path (no NVIDIA index, no RAPIDS)
            const tfOnlySpec = `foxtrot-core[${BASE_EXTRAS},gpu]@git+https://github.com/${OWNER}/foxtrot-core.git`;
            out.appendLine(`[Foxtrot] Retrying TensorFlow-only GPU: ${tfOnlySpec}`);
            await execProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', tfOnlySpec], {
              cwd: workspaceUri.fsPath,
            });
          } else if (action === 'Retry on CPU') {
            const cpuSpec = `foxtrot-core[${BASE_EXTRAS},cpu]@git+https://github.com/${OWNER}/foxtrot-core.git`;
            out.appendLine(`[Foxtrot] Retrying CPU path: ${cpuSpec}`);
            await execProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', cpuSpec], {
              cwd: workspaceUri.fsPath,
            });
          } else if (action === 'Analysis Only') {
            const anaSpec = `foxtrot-core[${BASE_EXTRAS}]@git+https://github.com/${OWNER}/foxtrot-core.git`;
            out.appendLine(`[Foxtrot] Installing analysis-only: ${anaSpec}`);
            await execProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', anaSpec], {
              cwd: workspaceUri.fsPath,
            });
          }
          // If user cancels, just fall through; nothing else to do.
        } else {
          out.appendLine(`[Foxtrot] Skipped ${name}: ${msg}`);
        }
      }
    } else {
      const spec = `${name}@git+https://github.com/${OWNER}/${name}.git`;
      out.appendLine(`[Foxtrot] pip install --upgrade ${spec}`);
      try {
        await execProcess(venvPython, [...baseArgs, spec], { cwd: workspaceUri.fsPath });
      } catch (err) {
        out.appendLine(`[Foxtrot] Skipped ${name}: ${(err as Error)?.message ?? err}`);
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers – GitHub API, compatibility, env                                   */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 *
 */
function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'Foxtrot-VSCode',
    Accept: 'application/vnd.github+json',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

/**
 *
 */
async function githubJson(url: string): Promise<unknown> {
  const raw = await httpRequest(url, { headers: githubHeaders() });
  return JSON.parse(raw) as unknown;
}

/**
 *
 */
async function fetchReleaseWheels(ownerRepo = OWNER_REPO): Promise<Array<ReleaseWheel>> {
  // Pull several recent releases (covers prereleases/hotfixes)
  const rels = await githubJson(`https://api.github.com/repos/${ownerRepo}/releases?per_page=20`);
  if (!Array.isArray(rels)) {
    return [];
  }

  const assets: ReleaseWheel[] = [];
  for (const r of rels) {
    const publishedAt = r.published_at || r.created_at || '';
    const prerelease = !!r.prerelease;
    for (const a of r.assets ?? []) {
      if (
        typeof a?.name === 'string' &&
        a.name.endsWith('.whl') &&
        typeof a.browser_download_url === 'string'
      ) {
        assets.push({ name: a.name, url: a.browser_download_url, prerelease, publishedAt });
      }
    }
  }

  // Newest first
  assets.sort((a, b) => (a.publishedAt > b.publishedAt ? -1 : 1));
  return assets;
}

/**
 *
 */
async function fetchFoxtrotRepos(owner: string): Promise<string[]> {
  // Try org then user; stop on the first that works.
  const urls = [
    `https://api.github.com/orgs/${owner}/repos?per_page=100`,
    `https://api.github.com/users/${owner}/repos?per_page=100`,
  ];
  for (const url of urls) {
    try {
      const res = await githubJson(url);
      if (Array.isArray(res)) {
        const names = (res as Array<Record<string, unknown>>)
          .map(r => (r as Record<string, unknown>)['name'])
          .filter((n): n is string => typeof n === 'string');
        if (names.length) {
          return names;
        }
      }
    } catch {
      // try next
    }
  }
  return [];
}

/**
 *
 */
function isWheelCompatible(name: string, pyTag: string, platHints: string[]): boolean {
  const n = name.toLowerCase();
  if (!n.endsWith('.whl')) {
    return false;
  }

  // Python compatibility: exact CP tag, any py3 wheel, or abi3 wheels.
  const pyOk =
    n.includes(`-${pyTag}-`) ||
    n.includes('-py3-') ||
    n.includes('-py3_') ||
    n.includes('py3-none') ||
    n.includes('-abi3-');

  // Platform compatibility: our OS/arch hints OR universal any.
  const platOk = platHints.some(h => n.includes(h)) || n.includes('none-any');

  // Avoid PyPy wheels unless they’re universal any.
  const notPyPy = !n.includes('-pp') || n.includes('none-any');

  return pyOk && platOk && notPyPy;
}

/**
 *
 */
function platformWheelHints(): string[] {
  if (process.platform === 'win32') {
    return ['win_amd64', 'win32'];
  }
  if (process.platform === 'darwin') {
    return ['macosx', 'universal2', 'arm64', 'x86_64'];
  }
  return ['manylinux', 'musllinux', 'linux'];
}

/**
 *
 */
async function detectCPTag(pythonExe: string): Promise<string> {
  const out = await execProcess(venvPython(exeDir(pythonExe)), [
    '-c',
    "import sys;print(f'cp{sys.version_info.major}{sys.version_info.minor}')",
  ]);
  return out.trim(); // e.g., cp311
}
// Helper to resolve the directory from a python path (for detectCPTag impl above)
/**
 *
 */
function exeDir(pythonExe: string): string {
  return path.dirname(pythonExe);
}
/**
 *
 */
function venvPython(dir: string): string {
  return path.join(dir, 'python');
}

/**
 *
 */
function logNoMatch(assets: Array<ReleaseWheel>, pyTag: string, platHints: string[]) {
  out.appendLine('[Foxtrot] No compatible wheels found in GitHub releases.');
  out.appendLine(`  Wanted python tag: ${pyTag}`);
  out.appendLine(`  Platform hints: ${platHints.join(', ')}`);
  out.appendLine('  Available wheel assets:');
  for (const a of assets) {
    out.appendLine(`   • ${a.name}`);
  }
}

/**
 *
 */
function hasCudaGpu(): boolean {
  try {
    cp.execSync('nvidia-smi -L', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Wheel grouping + picker helpers (releases path)                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 *
 */
function wheelPackageName(filename: string): string {
  // Wheel filename: <name>-<version>-<py tag>-<abi>-<plat>.whl
  // Normalize package key: use the <name> part, with '-' → '_' to match pip pkg naming.
  const m = /^([A-Za-z0-9_.-]+)-/.exec(filename);
  const raw = m ? m[1] : filename.replace(/\.whl$/i, '');
  return raw.replace(/-/g, '_');
}

/**
 *
 */
function isFoxtrotCorePkg(pkgKey: string): boolean {
  return pkgKey === 'foxtrot_core' || pkgKey === 'foxtrot-core';
}

/**
 *
 */
function pickLatestPerPackage(assets: ReleaseWheel[]): ReleaseWheel[] {
  // Assets already sorted newest → oldest at the release level; keep first occurrence per pkg
  const seen = new Set<string>();
  const outArr: ReleaseWheel[] = [];
  for (const a of assets) {
    const key = wheelPackageName(a.name);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    outArr.push(a);
  }
  return outArr;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* HTTP helpers (working approach)                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 *
 */
async function httpRequest(url: string, options: https.RequestOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, options, res => {
        const chunks: Buffer[] = [];
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return httpRequest(res.headers.location, options).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        res.on('data', d => chunks.push(Buffer.from(d)));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
}

/**
 *
 */
async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: githubHeaders() }, res => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          // NOTE: Recurse using the redirected URL (same working approach)
          return downloadFile(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        }
        const file = fs.createWriteStream(dest);
        pipeline(res, file)
          .then(() => resolve())
          .catch(reject);
      })
      .on('error', reject);
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Subprocess helper                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 *
 */
function execProcess(
  cmd: string,
  args: string[] | string,
  opts: cp.SpawnOptions & { cwd?: string } = {}
): Promise<string> {
  const argv = Array.isArray(args) ? args : [args];
  return new Promise((resolve, reject) => {
    const p = cp.spawn(cmd, argv, { ...opts, shell: false });
    let out = '';
    let err = '';
    p.stdout?.on('data', d => (out += d.toString()));
    p.stderr?.on('data', d => (err += d.toString()));
    p.on('close', code => {
      if (code === 0) {
        return resolve(out);
      }
      reject(new Error(`${cmd} ${argv.join(' ')} (exit ${code})\n${err || out}`));
    });
  });
}
