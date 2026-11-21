/**
 * Framework registry.
 *
 * `FRAMEWORK_META` in `@qatools/shared` is FROZEN and is the single source of truth for
 * labels, commands and docs URLs. This module only **derives** from it — it never
 * restates a command or a label, so a change in the shared constant flows straight
 * through to the API, the UI and every generated README.
 */

import type { CodegenFramework, CodegenLanguage, FrameworkMeta } from '@qatools/shared';
import { CODEGEN_FRAMEWORKS, FRAMEWORK_META, frameworkMeta } from '@qatools/shared';
import type { GeneratedFile, Generator } from './types.js';
import { generate as playwright } from './generators/playwright.js';
import { generate as robotframework } from './generators/robotframework.js';
import { generate as pytest } from './generators/pytest.js';
import { generate as cypress } from './generators/cypress.js';
import { generate as seleniumJava } from './generators/selenium-java.js';
import { generate as k6 } from './generators/k6.js';
import { generate as postman } from './generators/postman.js';
import { generate as restAssured } from './generators/rest-assured.js';

/** Map of framework id → its generator. Every `CODEGEN_FRAMEWORKS` entry must appear. */
export const GENERATORS: Record<CodegenFramework, Generator> = {
  playwright,
  robotframework,
  pytest,
  cypress,
  'selenium-java': seleniumJava,
  k6,
  postman,
  'rest-assured': restAssured,
};

/** Runtime guard: fails loudly at import time if a framework is missing a generator. */
function assertRegistryComplete(): void {
  const missing = CODEGEN_FRAMEWORKS.filter((id) => typeof GENERATORS[id] !== 'function');
  if (missing.length) {
    throw new Error(`codegen: generator belum terdaftar untuk framework: ${missing.join(', ')}`);
  }
}

assertRegistryComplete();

/** All framework metadata, in the frozen order. */
export function allFrameworks(): FrameworkMeta[] {
  return CODEGEN_FRAMEWORKS.map((id) => frameworkMeta(id));
}

export function frameworkInfo(id: CodegenFramework): FrameworkMeta {
  return frameworkMeta(id);
}

export function generatorFor(id: CodegenFramework): Generator {
  const generator = GENERATORS[id];
  if (!generator) {
    throw new Error(`codegen: framework "${id}" belum didukung`);
  }
  return generator;
}

export function isSupported(id: string): id is CodegenFramework {
  return (CODEGEN_FRAMEWORKS as readonly string[]).includes(id);
}

/** The language a framework's primary output uses (from FRAMEWORK_META). */
export function languageFor(id: CodegenFramework): CodegenLanguage {
  return frameworkMeta(id).language;
}

/** Re-exported for callers that want the raw frozen list without importing shared. */
export { CODEGEN_FRAMEWORKS, FRAMEWORK_META };

/** Type-only alias so callers can talk about a generated file without importing shared. */
export type { GeneratedFile, Generator };
