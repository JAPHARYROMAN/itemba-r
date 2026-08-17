/**
 * Controller discovery for the capability manifest.
 *
 * Walks the modules tree and loads every `*.controller` file, returning the
 * exported classes that carry Nest route metadata. Filesystem discovery rather
 * than an explicit list, so a new controller is picked up — and therefore
 * classified, or fails the drift spec — without anyone remembering to register it.
 *
 * Works from source under ts-jest and from `dist` at runtime; the extension is
 * inferred from this module's own filename.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { ControllerClass } from './capability-manifest';

/** `.ts` under ts-jest, `.js` when running compiled output. */
const SOURCE_EXTENSION = path.extname(__filename);

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      entry.name.endsWith(`.controller${SOURCE_EXTENSION}`) &&
      !entry.name.endsWith(`.spec${SOURCE_EXTENSION}`)
    ) {
      out.push(full);
    }
  }
  return out;
}

function isControllerClass(value: unknown): value is ControllerClass {
  return (
    typeof value === 'function' && Reflect.getMetadata(PATH_METADATA, value as object) !== undefined
  );
}

/**
 * Loads every controller class under the modules tree.
 *
 * @param modulesDir Defaults to the sibling `modules` directory.
 */
export function loadAllControllers(
  modulesDir: string = path.resolve(__dirname, '..', '..', 'modules'),
): ControllerClass[] {
  const found = new Map<string, ControllerClass>();

  for (const file of walk(modulesDir)) {
    // Synchronous require is deliberate: the manifest is built eagerly (in a
    // spec, and at module init for the tool registry), and dynamic import()
    // would make every caller async for no benefit under CommonJS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(file) as Record<string, unknown>;
    for (const exported of Object.values(loaded)) {
      if (isControllerClass(exported)) {
        // Key by class name so a controller re-exported through a barrel is
        // counted once rather than duplicating its capabilities.
        found.set(exported.name, exported);
      }
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
