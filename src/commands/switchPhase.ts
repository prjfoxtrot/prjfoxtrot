/**
 * Foxtrot – Phase Switcher
 * ------------------------
 * Programmatic and Command‑Palette helpers to change the active
 * Foxtrot domain.
 *
 * Responsibilities:
 *  • Map phase slugs → primary view IDs.
 *  • Update `viewPhase` context key for when‑clauses.
 *  • Reveal the Foxtrot container in the Activity Bar.
 *  • Focus the requested view.
 */

import * as vscode from 'vscode';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Mapping from phase slug → primary view ID */
const PHASE_TO_VIEW = {
  bitgen: 'foxtrot.bitgen.panel',
  bitmap: 'foxtrot.bitmap.explorer',
  fabmap: 'foxtrot.fabmap.explorer',
  bitlearn: 'foxtrot.bitlearn.explorer',
  netrec: 'foxtrot.netrec.explorer',
} as const;

/** All valid Foxtrot phase identifiers */
export type FoxtrotPhase = keyof typeof PHASE_TO_VIEW;

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Switch the Foxtrot sidebar to the requested phase.
 * @param {FoxtrotPhase} phase - Foxtrot phase slug.
 * @returns {Promise<void>}
 */
export async function switchPhase(phase: FoxtrotPhase): Promise<void> {
  const viewId = PHASE_TO_VIEW[phase];
  if (!viewId) {
    void vscode.window.showErrorMessage(`Unknown Foxtrot phase: ${phase}`);
    return;
  }

  // 1) Update context key for view "when" clauses.
  await vscode.commands.executeCommand('setContext', 'viewPhase', phase);

  // 2) Reveal Foxtrot container in Activity Bar.
  await vscode.commands.executeCommand('workbench.view.extension.foxtrot');

  // 3) Focus the target view.
  await vscode.commands.executeCommand(`${viewId}.focus`);
}

/**
 * Register the palette command **Foxtrot: Switch Phase**.
 * @param {vscode.ExtensionContext} ctx - Extension context.
 */
export function register(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('foxtrot.view.switch', async () => {
      const phase = await vscode.window.showQuickPick(Object.keys(PHASE_TO_VIEW), {
        placeHolder: 'Select Foxtrot phase',
      });

      if (phase) {
        await switchPhase(phase as FoxtrotPhase);
      }
    })
  );
}
