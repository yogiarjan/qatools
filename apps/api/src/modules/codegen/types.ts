/**
 * Internal shapes shared by the codegen module's gatherer and its generators.
 *
 * The *public* shapes (`GeneratedFile`, `GeneratedProject`, `CodegenRequest`,
 * `FrameworkMeta`, `CodegenFramework`) live in `@qatools/shared` and are FROZEN —
 * this file only adds the intermediate "resolved artifact" model that generators
 * consume, so no generator has to re-query SQLite.
 */

import type {
  ApiRequest,
  Assertion,
  CodegenFramework,
  CodegenLanguage,
  CodegenRequest,
  DbCheck,
  GeneratedFile,
  LayerKind,
  Project,
  TestCase,
  TestStep,
  WebFlow,
  WebStep,
} from '@qatools/shared';

/**
 * `GeneratedFile` is *declared* in the frozen shared package; re-exporting it here
 * lets generators import their shapes from one place (`../types.js`) without reaching
 * into `@qatools/shared` for scaffolding types.
 */
export type { GeneratedFile };

/** Which QATools layer a generator hands to `ctx.warn` when nothing was found. */
export const GENERATOR_LAYERS = ['web', 'api', 'db', 'performance'] as const;
export type GeneratorLayer = (typeof GENERATOR_LAYERS)[number];

/** Where a test-case sits in the traceability chain — used as a code comment. */
export interface Ancestry {
  requirement: string | null;
  use_case: string | null;
  scenario: string | null;
}

/** A scenario/test case pair ready to be emitted. */
export interface ResolvedCase {
  test_case: TestCase;
  steps: TestStep[];
  ancestry: Ancestry;
  /** JSON `test_data` column, normalised to a record list. */
  data: Array<{ field: string; value: string }>;
  tags: string[];
  preconditions: string[];
}

/** A web flow bound to the case it automates (or standalone when unbound). */
export interface ResolvedFlow {
  flow: WebFlow;
  steps: WebStep[];
  viewport: { width: number; height: number };
  start_url: string;
  test_case_id: string | null;
  test_case_title: string | null;
  test_case_code: string | null;
}

/** An API request plus the collection-level defaults it inherits. */
export interface ResolvedRequest {
  request: ApiRequest;
  assertions: Assertion[];
  headers: Record<string, string>;
  query: Record<string, string>;
  collection_name: string;
  base_url: string;
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'api_key';
    token: string | null;
    username: string | null;
    password: string | null;
    header: string | null;
    key: string | null;
    value: string | null;
  };
  collection_variables: Record<string, string>;
  test_case_id: string | null;
  test_case_code: string | null;
  test_case_title: string | null;
}

/** A DB check plus the dialect/DSN of the connection it runs against. */
export interface ResolvedDbCheck {
  check: DbCheck;
  assertions: Assertion[];
  dialect: 'sqlite' | 'postgres' | 'mysql';
  connection_name: string;
  /** Masked DSN for comments; the generator never needs the secret. */
  dsn_masked: string;
  test_case_id: string | null;
  test_case_code: string | null;
  test_case_title: string | null;
}

/** Performance expectations distilled from a case's tags / data / estimated effort. */
export interface PerformanceProfile {
  vus: number;
  duration_s: number;
  p95_ms: number;
  error_rate: number;
  stages: Array<{ target: number; duration: string }>;
}

/**
 * Everything a generator may read. Built once per codegen run by `gather.ts`;
 * generators are pure functions of this object (plus their own string building),
 * which is what makes them trivially unit-testable.
 */
export interface GenerateContext {
  project: {
    id: string;
    key: string;
    name: string;
    target_url: string | null;
  };
  framework: CodegenFramework;
  /** Sanitised, filesystem-safe project name used for the ZIP root / Maven artifactId. */
  slug: string;
  /** Human-readable package/namespace derived from the slug (Java, Postman folders). */
  package_name: string;
  base_url: string;
  request: CodegenRequest;
  layers: GeneratorLayer[];
  parallel: boolean;
  workers: number;
  cases: ResolvedCase[];
  flows: ResolvedFlow[];
  requests: ResolvedRequest[];
  db_checks: ResolvedDbCheck[];
  /** Warnings accumulated by the gatherer before any generator ran. */
  warnings: string[];
  /** True when AI enrichment was requested; generators only change comments/names. */
  ai_enriched: boolean;
}

/** Signature every framework generator implements. */
export type Generator = (ctx: GenerateContext) => GeneratedFile[];

/** Fields every generated file must carry (see ARCHITECTURE.md §11.3 rule 5). */
export type EmittedFile = GeneratedFile;

/** Line counter used to fill `GeneratedFile.lines` consistently. */
export function countLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

/** Convenience factory so every generator reports `lines` the same way. */
export function file(
  path: string,
  language: CodegenLanguage,
  purpose: string,
  content: string,
): GeneratedFile {
  return { path, language, content, lines: countLines(content), purpose };
}

/**
 * Maps a QATools test-case layer onto the generator layer vocabulary.
 * `mobile` and `unit` have no codegen target and map to null (the caller warns).
 */
export function toGeneratorLayer(layer: LayerKind): GeneratorLayer | null {
  switch (layer) {
    case 'web':
      return 'web';
    case 'api':
      return 'api';
    case 'db':
      return 'db';
    default:
      return null;
  }
}

/** The project an ancestor row belongs to — kept tiny so gather can return it. */
export type CodegenProject = Pick<Project, 'id' | 'key' | 'name' | 'target_url'>;
