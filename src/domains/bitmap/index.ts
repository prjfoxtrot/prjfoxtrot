/**
 * Bitmap Domain
 * -------------
 * Registers the BitMap explorer tree view (`foxtrot.bitmap.explorer`)
 * and the BitMap details webview panel (`foxtrot.bitmap.panel`).
 *
 * Called from the extension entry‑point when the workspace is in the *bitmap*
 * phase.
 */

import * as vscode from 'vscode';

// local imports
import { BitmapPanel } from './BitmapPanel';
import { BitmapProvider } from './providers/BitmapProvider';

/* -------------------------------------------------------------------------- */
/* Activate                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Activates the BitMap domain.
 * @param {vscode.ExtensionContext} ctx - VS Code extension context.
 */
export function activate(ctx: vscode.ExtensionContext): void {
  /* Explorer (tree view on the left) ------------------------------------- */
  const provider = new BitmapProvider(ctx.extensionPath);

  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('foxtrot.bitmap.explorer', provider)
  );

  /* Detail panel (webview on the right) ---------------------------------- */
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'foxtrot.bitmap.panel',
      new BitmapPanel(ctx, provider)
    )
  );
}
