/**
 * Foxtrot Domain Registry
 * -----------------------
 * Central entry point that wires up and activates all Foxtrot domain
 * modules. The Welcome domain is activated first so users immediately
 * see a splash panel while the workspace bootstraps. The remaining
 * domains are loaded in parallel to minimise startup latency.
 *
 * Layer / Path: src/domains/index.ts
 */

import * as vscode from 'vscode';

import * as bitgen from './bitgen';
import * as bitlearn from './bitlearn';
import * as bitmap from './bitmap';
import * as fabmap from './fabmap';
import * as netrec from './netrec';
import * as welcome from './welcome';

/**
 * Activate all Foxtrot domain modules.
 * @param {vscode.ExtensionContext} ctx VS Code extension context passed to each domain's `activate` function.
 */
export async function registerDomains(ctx: vscode.ExtensionContext): Promise<void> {
  // Show the Welcome panel first for instant visual feedback.
  await welcome.activate(ctx);

  // Kick off the remaining domain activations concurrently.
  await Promise.all([
    bitgen.activate(ctx),
    bitmap.activate(ctx),
    fabmap.activate(ctx),
    bitlearn.activate(ctx),
    netrec.activate(ctx),
  ]);
}
