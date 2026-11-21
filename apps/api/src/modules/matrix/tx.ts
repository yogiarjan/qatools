/**
 * Lane A transaction helper.
 *
 * `db.transaction()` in `src/db/index.ts` (frozen, lead-owned) issues a bare
 * `BEGIN`, so nesting it throws "cannot start a transaction within a transaction".
 * Lane A repo helpers such as `replaceSteps()` open their own transaction, which
 * would collide when a route handler wraps several writes in an outer transaction.
 *
 * `withTransaction()` is re-entrant: only the outermost call opens a real
 * transaction, so callers can compose freely.
 */

import { db } from '../../db/index.js';

let depth = 0;

export function withTransaction<T>(fn: () => T): T {
  if (depth > 0) {
    // Already inside a transaction: join it instead of nesting.
    depth += 1;
    try {
      return fn();
    } finally {
      depth -= 1;
    }
  }

  depth = 1;
  try {
    return db.transaction(fn);
  } finally {
    depth = 0;
  }
}
