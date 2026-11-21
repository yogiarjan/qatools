/**
 * Navigation types + lifecycle-stage ordering. FROZEN (lead-owned).
 * Lane feature folders may export `navEntries: NavEntry[]` from `<feature>/nav.ts`.
 */

import type { QaStage } from '@qatools/shared';

export interface NavEntry {
  id: string;
  label: string;
  path: string;
  /** Which lifecycle stage this page belongs to — drives sidebar grouping and ordering. */
  stage: QaStage | 'overview' | 'learn';
  icon?: string;
  /** Optional route param, e.g. '/projects/:projectId/matrix'. */
  hidden?: boolean;
}
