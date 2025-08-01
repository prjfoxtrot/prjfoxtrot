/**
 * BitgenProvider
 * --------------
 * Discovers Foxtrot EDA plug-ins, FPGA parts and fuzzers for the *Bit-Gen*
 * phase.
 *
 * Discovery pipeline
 * 1. Parse wheel archives in **plugins-bundled/** (workspace overrides first,
 *    then VSIX fallback).
 * 2. Query the workspace venv for already-installed wheels via
 *    `importlib.metadata.entry_points('foxtrot.plugins')`.
 * 3. Merge both sources — wheel archives always win over site-packages.
 *
 * Implementation notes
 * • Heavy deps (`adm-zip`, `ini`) are lazy-loaded.
 * • Python subprocess is capped to 5 s; failures are written to the Foxtrot
 *   output channel but never surface to the UI.
 * • The resulting tree is deterministic (alphabetical) to prevent UI jitter.
 */

import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import type { IZipEntry } from 'adm-zip';

import { uriExists } from '../../../utils/pythonUtils';

/* -------------------------------------------------------------------------- */
/* Types & lazy-loaded deps                                                   */
/* -------------------------------------------------------------------------- */

type Lazy<T> = () => Promise<T>;

/** Minimal subset of *entry_points.txt* we care about. */
interface ParsedIni {
  'foxtrot.plugins'?: Record<string, string>;
  foxtrot?: { plugins?: Record<string, string> };
}

/** Node shape used by the web-view tree widgets. */
export interface TreeNode {
  label: string;
  path: string;
  children?: TreeNode[];
}

type AdmZipCtor = typeof import('adm-zip');

const loadAdmZip: Lazy<AdmZipCtor> = async () => {
  const mod: unknown = await import('adm-zip');
  return ((mod as { default?: unknown }).default ?? mod) as AdmZipCtor;
};

const loadIni: Lazy<typeof import('ini')> = async () => import('ini');

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export class BitgenProvider {
  private readonly wsRoot: string;
  private readonly builtinRoot: string;

  /**
   * @param {string} extensionPath Absolute path to the VSIX extension root.
   */
  constructor(extensionPath: string) {
    this.wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    this.builtinRoot = path.join(extensionPath, 'plugins-bundled');
  }

  /** Grouped tree of *EDA plug-in → version* nodes. */
  getPluginTree(): Promise<TreeNode[]> {
    return buildPluginTree(
      [
        path.join(this.wsRoot, 'plugins-bundled'), // workspace overrides
        this.builtinRoot, // VSIX fallback
      ],
      this.wsRoot
    );
  }

  /** `<family>/<device>/<part>` hierarchy from `devices/`. */
  getPartTree(): Promise<TreeNode[]> {
    return buildPartTree(this.wsRoot);
  }

  /** Every fuzzer script found under `fuzzers/`. */
  getFuzzerTree(): Promise<TreeNode[]> {
    return buildFuzzerTree(this.wsRoot);
  }
}

/* -------------------------------------------------------------------------- */
/* Plug-in discovery                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Merge wheel archives and venv entry-points into a deterministic tree.
 * @param {ReadonlyArray<string>} roots  Wheel roots to scan.
 * @param {string} wsRoot Workspace root used to locate `.venv`.
 */
async function buildPluginTree(roots: ReadonlyArray<string>, wsRoot: string): Promise<TreeNode[]> {
  /** Map<tool, Map<version, pluginId>> */
  const map: Map<string, Map<string, string>> = new Map();

  /* 1 ── wheel archives -------------------------------------------------- */
  await Promise.all(
    roots.map(async root => {
      let files: string[] = [];
      try {
        files = await fs.readdir(root);
      } catch {
        return; // dir missing → skip
      }

      await Promise.all(
        files
          .filter(f => f.endsWith('.whl'))
          .map(async file => {
            const wheel = path.join(root, file);
            const AdmZip = await loadAdmZip();

            let txt: string | undefined;
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call
              const zip = new AdmZip(wheel);
              const hit = (zip.getEntries() as IZipEntry[]).find(e =>
                /\/entry_points\.txt$/.test(e.entryName)
              );
              if (hit) {
                txt = hit.getData().toString('utf8');
              }
            } catch {
              return; // corrupt archive
            }

            if (!txt) {
              return;
            }

            const ini = await loadIni();
            const parsed = ini.parse(txt) as ParsedIni;
            const plugins = parsed['foxtrot.plugins'] ?? parsed.foxtrot?.plugins;
            if (!plugins) {
              return;
            }

            Object.keys(plugins).forEach(id => recordPlugin(id, map));
          })
      );
    })
  );

  /* 2 ── site-packages --------------------------------------------------- */
  await mergeSitePackages(wsRoot, map);

  /* 3 ── deterministic output ------------------------------------------- */
  return [...map.keys()].sort().map(tool => ({
    label: tool,
    path: tool,
    children: [...map.get(tool)!.keys()].sort().map(ver => ({
      label: ver,
      path: map.get(tool)!.get(ver)!,
    })),
  }));
}

/**
 * Register a plug-in ID of the form `<tool>_<version>` into the aggregate map.
 * @param {string} id  Entry-point name.
 * @param {Map<string, Map<string, string>>} map Aggregate map being built.
 */
function recordPlugin(id: string, map: Map<string, Map<string, string>>): void {
  if (!id.includes('_')) {
    return; // helper / non-EDA wheels
  }

  const [tool, ...rest] = id.split('_');
  const ver = rest.join('_') || 'unknown';

  if (!map.has(tool)) {
    map.set(tool, new Map());
  }
  map.get(tool)!.set(ver, id);
}

/**
 * Extend the map with plug-ins present in `.venv/lib/site-packages`.
 * Wheel archives remain authoritative — existing entries are not overwritten.
 * @param {string} wsRoot Workspace root.
 * @param {Map<string, Map<string, string>>} map Aggregate map to extend.
 */
async function mergeSitePackages(
  wsRoot: string,
  map: Map<string, Map<string, string>>
): Promise<void> {
  const py =
    process.platform === 'win32'
      ? path.join(wsRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(wsRoot, '.venv', 'bin', 'python');

  if (!(await uriExists(vscode.Uri.file(py)))) {
    return;
  }

  const snippet = `
import json, importlib.metadata as im, re, sys
out = {}
for ep in im.entry_points().get('foxtrot.plugins', []):
    m = re.match(r'(\\w+?)_(.+)', ep.name)
    if m:
        tool, ver = m.groups()
        out.setdefault(tool, {})[ver] = ep.name
json.dump(out, sys.stdout)
`;

  try {
    const txt = cp.execFileSync(py, ['-c', snippet], {
      encoding: 'utf8',
      timeout: 5_000,
    });
    const discovered: Record<string, Record<string, string>> = JSON.parse(txt);

    Object.entries(discovered).forEach(([tool, vers]) => {
      if (!map.has(tool)) {
        map.set(tool, new Map());
      }
      Object.entries(vers).forEach(([ver, id]) => {
        if (!map.get(tool)!.has(ver)) {
          map.get(tool)!.set(ver, id);
        }
      });
    });
  } catch (err) {
    vscode.window
      .createOutputChannel('Foxtrot')
      .appendLine(`[Foxtrot] site-packages scan failed: ${(err as Error).message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* FPGA parts                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build a three-level tree `<family>/<device>/<part>` from `devices/`.
 * @param {string} wsRoot Workspace root.
 */
async function buildPartTree(wsRoot: string): Promise<TreeNode[]> {
  return walk(path.join(wsRoot, 'devices'), 0);

  /**
   * Recursively walk `dir` and build a tree of device/part nodes.
   * @param {string} dir Directory to scan.
   * @param {number} depth Recursion depth.
   */
  async function walk(dir: string, depth: number): Promise<TreeNode[]> {
    const entries = (await safeDirs(dir)).filter(isVisible);
    const nodes: TreeNode[] = [];

    await Promise.all(
      entries.map(async entry => {
        const abs = path.join(dir, entry);

        if (depth === 2) {
          if (await hasAnyFile(abs, ['pinout.json', 'fabric.json'])) {
            nodes.push({ label: entry, path: abs });
          }
        } else {
          const children = await walk(abs, depth + 1);
          if (children.length) {
            nodes.push({ label: entry, path: abs, children });
          }
        }
      })
    );

    return nodes.sort(alphaSort);
  }
}

/* -------------------------------------------------------------------------- */
/* Fuzzers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Recursively discover fuzzers under `fuzzers/`.
 * @param {string} wsRoot Workspace root.
 */
async function buildFuzzerTree(wsRoot: string): Promise<TreeNode[]> {
  const root = path.join(wsRoot, 'fuzzers');
  return walk(root);

  /**
   * Recursively walk `dir` and build a tree of fuzzer nodes.
   * @param {string} dir Directory to scan.
   */
  async function walk(dir: string): Promise<TreeNode[]> {
    const entries = (await safeDirs(dir)).filter(isVisible);
    const nodes: TreeNode[] = [];

    await Promise.all(
      entries.map(async entry => {
        const abs = path.join(dir, entry);
        const script = await mainScript(abs);

        if (script) {
          const rel = path.relative(wsRoot, script).replace(/\\/g, '/');
          nodes.push({ label: entry, path: rel });
          return;
        }

        const children = await walk(abs);
        if (children.length) {
          nodes.push({ label: entry, path: abs, children });
        }
      })
    );

    return nodes.sort(alphaSort);
  }

  /** Return the main `.py` script inside `script/`, if present. */
  async function mainScript(dir: string): Promise<string | undefined> {
    const scriptDir = path.join(dir, 'script');
    try {
      const files = await fs.readdir(scriptDir);
      const pyFiles = files.filter(f => f.endsWith('.py'));
      if (!pyFiles.length) {
        return;
      }

      const preferred = `${path.basename(dir)}.py`;
      const pick = pyFiles.includes(preferred) ? preferred : pyFiles.sort()[0];
      return path.join(scriptDir, pick);
    } catch {
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

const isVisible = (n: string): boolean => !n.startsWith('.') && n !== '__pycache__';

const alphaSort = (a: TreeNode, b: TreeNode): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });

/** Read sub-directories of `dir`, ignoring errors. */
async function safeDirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

/** `true` if `dir/name` exists (non-throwing). */
async function fileExists(dir: string, name: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, name));
    return true;
  } catch {
    return false;
  }
}

/** `true` if any of `names` is present in `dir`. */
async function hasAnyFile(dir: string, names: ReadonlyArray<string>): Promise<boolean> {
  for (const n of names) {
    if (await fileExists(dir, n)) {
      return true;
    }
  }
  return false;
}
