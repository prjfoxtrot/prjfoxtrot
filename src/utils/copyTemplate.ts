/**
 * copyTemplate
 * ------------
 * Recursively copy a template directory into a new destination folder.
 *
 * Uses fs-extra's copy() to preserve file permissions & timestamps.
 * The destination must not exist; overwrite is disabled and errorOnExist is enabled.
 * @param {string} src - Absolute path to the template directory.
 * @param {string} dst - Absolute path to the destination directory.
 * @returns {Promise<void>} Resolves when the copy operation completes.
 * @throws {Error} If the destination exists or the copy operation fails.
 */

import fs from 'fs-extra';

/**
 * Copy a template directory to a new destination.
 * @param {string} src - Absolute path to the template directory.
 * @param {string} dst - Absolute path to the destination directory.
 * @returns {Promise<void>} Resolves when the operation completes.
 */
export async function copyTemplate(src: string, dst: string): Promise<void> {
  await fs.copy(src, dst, { overwrite: false, errorOnExist: true });
}
