/**
 * Shared presentational primitives. FROZEN (lead-owned).
 * Lanes import these instead of re-implementing tables/modals/badges.
 */

import React, { useEffect, type ReactNode } from 'react';
import type { BadgeTone } from '@qatools/shared';

/* ------------------------------- Page header ---------------------------- */

export function PageHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">
          {props.title}
          {props.badge}
        </h1>
        {props.subtitle ? <p className="page-sub">{props.subtitle}</p> : null}
      </div>
      {props.actions ? <div className="row row-wrap">{props.actions}</div> : null}
    </div>
  );
}

/* --------------------------------- Card --------------------------------- */

export function Card(props: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`card ${props.onClick ? 'card-hover' : ''} ${props.className ?? ''}`}
      onClick={props.onClick}
      style={props.style}
    >
      {props.title || props.actions ? (
        <div className="row-between" style={{ marginBottom: props.subtitle ? 2 : 'var(--space-3)' }}>
          {props.title ? <h3 className="card-title">{props.title}</h3> : <span />}
          {props.actions}
        </div>
      ) : null}
      {props.subtitle ? <p className="card-sub">{props.subtitle}</p> : null}
      {props.children}
    </div>
  );
}

/* --------------------------------- Stat --------------------------------- */

export function Stat(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'accent' | 'ok' | 'warn' | 'err' | 'info';
}) {
  const tone = props.tone ?? 'default';
  return (
    <div className={`stat ${tone === 'default' ? '' : `stat-${tone}`}`}>
      <span className="stat-label">{props.label}</span>
      <span className="stat-value">{props.value}</span>
      {props.hint ? <span className="stat-delta">{props.hint}</span> : null}
    </div>
  );
}

/* -------------------------------- Badge --------------------------------- */

export function Badge(props: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${props.tone ?? 'muted'}`} title={props.title}>
      {props.children}
    </span>
  );
}

/* ------------------------------- Progress ------------------------------- */

export function Progress(props: { value: number; tone?: 'default' | 'ok' | 'warn' | 'err'; large?: boolean }) {
  const v = Math.max(0, Math.min(100, props.value || 0));
  return (
    <div
      className={`progress ${props.tone && props.tone !== 'default' ? `progress-${props.tone}` : ''} ${
        props.large ? 'progress-lg' : ''
      }`}
    >
      <div className="progress-bar" style={{ width: `${v}%` }} />
    </div>
  );
}

/* ---------------------------- State components -------------------------- */

export function Loading(props: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner spinner-lg" />
      <span>{props.label ?? 'Memuat…'}</span>
    </div>
  );
}

export function ErrorBox(props: { error: unknown; onRetry?: () => void }) {
  const msg = props.error instanceof Error ? props.error.message : String(props.error);
  return (
    <div className="alert alert-err">
      <span>⚠️</span>
      <div style={{ flex: 1 }}>
        <div className="strong">Terjadi kesalahan</div>
        <div>{msg}</div>
      </div>
      {props.onRetry ? (
        <button className="btn btn-sm" onClick={props.onRetry}>
          Coba lagi
        </button>
      ) : null}
    </div>
  );
}

export function Empty(props: {
  icon?: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon ?? '🗂️'}</div>
      <div className="empty-title">{props.title}</div>
      {props.subtitle ? <p className="empty-sub">{props.subtitle}</p> : null}
      {props.action}
    </div>
  );
}

/* --------------------------------- Modal -------------------------------- */

export function Modal(props: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  return (
    <div
      className="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className={`modal-panel ${props.size === 'sm' ? 'modal-panel-sm' : ''} ${
          props.size === 'lg' ? 'modal-panel-lg' : ''
        }`}
      >
        <div className="modal-header">
          <h2 className="modal-title">{props.title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={props.onClose} title="Tutup (Esc)">
            ✕
          </button>
        </div>
        {props.children}
        {props.footer ? <div className="modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}

/* --------------------------------- Field -------------------------------- */

export function Field(props: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span className="label">
        {props.label}
        {props.required ? <span style={{ color: 'var(--err)' }}> *</span> : null}
      </span>
      {props.children}
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </label>
  );
}

/* --------------------------------- Tabs --------------------------------- */

export function Tabs<T extends string>(props: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs">
      {props.tabs.map((t) => (
        <button
          key={t.id}
          className={`tab ${props.active === t.id ? 'active' : ''}`}
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- Confirm ------------------------------- */

export function ConfirmDialog(props: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={props.onCancel} disabled={props.busy}>
            Batal
          </button>
          <button
            className={`btn ${props.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? 'Memproses…' : props.confirmLabel ?? 'Konfirmasi'}
          </button>
        </>
      }
    >
      <div className="muted">{props.message}</div>
    </Modal>
  );
}

/* ----------------------------- Data table ------------------------------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>(props: {
  rows: T[];
  columns: Array<Column<T>>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  loading?: boolean;
}) {
  if (props.loading) return <Loading />;
  if (!props.rows.length) {
    return <>{props.empty ?? <Empty title="Belum ada data" />}</>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'left' }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr
              key={props.rowKey(row)}
              onClick={props.onRowClick ? () => props.onRowClick?.(row) : undefined}
              style={props.onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {props.columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ List editor ----------------------------- */

/** Editable list of plain strings (preconditions, flows, business rules…). */
export function StringListEditor(props: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  return (
    <div className="field">
      <span className="label">{props.label}</span>
      <div className="stack stack-sm">
        {props.values.map((v, i) => (
          <div className="row" key={i}>
            <span className="cell-mono" style={{ width: 22 }}>
              {i + 1}.
            </span>
            <input
              className="input input-sm"
              value={v}
              placeholder={props.placeholder}
              onChange={(e) => {
                const next = [...props.values];
                next[i] = e.target.value;
                props.onChange(next);
              }}
            />
            <button
              className="btn btn-ghost btn-sm"
              title="Hapus"
              onClick={() => props.onChange(props.values.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => props.onChange([...props.values, ''])}
        >
          + {props.addLabel ?? 'Tambah baris'}
        </button>
      </div>
    </div>
  );
}

/** Editable key/value list, used for test data and variables. */
export function KeyValueEditor(props: {
  label: string;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const entries = Object.entries(props.values);
  return (
    <div className="field">
      <span className="label">{props.label}</span>
      <div className="stack stack-sm">
        {entries.map(([k, v], i) => (
          <div className="row" key={i}>
            <input
              className="input input-sm"
              style={{ maxWidth: 180 }}
              value={k}
              placeholder="nama"
              onChange={(e) => {
                const next: Record<string, string> = {};
                entries.forEach(([ek, ev], j) => {
                  next[j === i ? e.target.value : ek] = ev;
                });
                props.onChange(next);
              }}
            />
            <input
              className="input input-sm"
              value={v}
              placeholder="nilai"
              onChange={(e) => props.onChange({ ...props.values, [k]: e.target.value })}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const next = { ...props.values };
                delete next[k];
                props.onChange(next);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => props.onChange({ ...props.values, '': '' })}
        >
          + Tambah
        </button>
      </div>
    </div>
  );
}

/* ------------------------------- Helpers -------------------------------- */

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDuration(ms?: number | null): string {
  if (!ms || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function pctLabel(v?: number | null): string {
  return `${(v ?? 0).toFixed(1)}%`;
}
