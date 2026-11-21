/**
 * Shared types for the matrix module (internal, not part of the frozen vocabulary).
 */

import type { TraceLinkType } from '@qatools/shared';

/** Every link type lane A derives. `usecase_to_testcase` is internal-only (direct parenting). */
export type LinkType = TraceLinkType | 'usecase_to_testcase';

/** Link type → (from_kind, to_kind) as stored in `matrix_links`. */
export const LINK_KINDS: Record<LinkType, { from: string; to: string }> = {
  requirement_to_usecase: { from: 'requirement', to: 'usecase' },
  usecase_to_scenario: { from: 'usecase', to: 'scenario' },
  scenario_to_testcase: { from: 'scenario', to: 'testcase' },
  testcase_to_defect: { from: 'testcase', to: 'defect' },
  requirement_to_testcase: { from: 'requirement', to: 'testcase' },
  testcase_to_automation: { from: 'testcase', to: 'automation' },
  usecase_to_defect: { from: 'usecase', to: 'defect' },
  usecase_to_testcase: { from: 'usecase', to: 'testcase' },
};

/** Link types the public API accepts for manual matrix edits (the frozen vocabulary). */
export const PUBLIC_LINK_TYPES: LinkType[] = [
  'requirement_to_usecase',
  'usecase_to_scenario',
  'scenario_to_testcase',
  'testcase_to_defect',
  'requirement_to_testcase',
  'testcase_to_automation',
  'usecase_to_defect',
];

export function isLinkType(v: unknown): v is LinkType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LINK_KINDS, v);
}

export interface SyncCounts {
  requirement_to_usecase: number;
  usecase_to_scenario: number;
  scenario_to_testcase: number;
  requirement_to_testcase: number;
  testcase_to_automation: number;
  removed: number;
  total: number;
}
