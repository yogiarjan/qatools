/**
 * Toast notifications. FROZEN (lead-owned).
 *   import { toast } from '../lib/toast';
 *   toast.ok('Tersimpan');
 */

import { useEffect, useState } from 'react';

export type ToastTone = 'info' | 'ok' | 'err' | 'warn';
export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const l of listeners) l(items);
}

function push(tone: ToastTone, message: string, ttl = 4200) {
  const id = ++seq;
  items = [...items, { id, tone, message }];
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, ttl);
}

export const toast = {
  info: (m: string) => push('info', m),
  ok: (m: string) => push('ok', m),
  err: (m: string) => push('err', m, 6500),
  warn: (m: string) => push('warn', m, 5500),
  /** Reports an unknown thrown value without leaking stack traces to the user. */
  fromError: (err: unknown, prefix = 'Gagal') => {
    const msg = err instanceof Error ? err.message : String(err);
    push('err', `${prefix}: ${msg}`, 6500);
  },
};

export function useToasts(): ToastItem[] {
  const [state, setState] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setState);
    setState(items);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}
