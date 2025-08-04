/**
 * Bit-Gen Domain
 * --------------
 * Entry point for the **Bit-Gen** phase. Registers a single WebView panel
 * and keeps it in sync with the global Foxtrot store.
 *
 * Public API:
 * - `activate` – called by the extension host when this domain is activated.
 *
 * ## Design Notes
 * - The WebView provider is registered once per workspace.
 * - The global store subscription is disposed automatically when the
 *   extension is deactivated, preventing memory leaks.
 */

import * as vscode from 'vscode';

// Local modules --------------------------------------------------------------
import { useFoxtrotStore } from '../../app/state';

import { BitgenPanel } from './BitgenPanel';
import { BitgenProvider } from './providers/BitgenProvider';

/* -------------------------------------------------------------------------- */
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Activate the Bit-Gen domain.
 * @param {vscode.ExtensionContext} ctx - VS Code extension context.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  // Create the WebView provider and panel.
  const provider = new BitgenProvider(ctx.extensionPath);
  const panel = new BitgenPanel(ctx, provider);

  // Register the WebView provider in the activity bar.
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('foxtrot.bitgen.panel', panel));

  // Keep the panel in sync with the global Foxtrot store.
  const unsubscribe = useFoxtrotStore().subscribe(() => panel['pushData']?.());
  ctx.subscriptions.push({ dispose: unsubscribe });
}
