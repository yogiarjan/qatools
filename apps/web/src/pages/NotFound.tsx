/** 404 page. FROZEN (lead-owned). */

import React from 'react';
import { NavLink } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="empty">
      <div className="empty-icon">🧭</div>
      <div className="empty-title">Halaman tidak ditemukan</div>
      <p className="empty-sub">Rute yang Anda tuju tidak ada di QATools.</p>

      <NavLink className="btn btn-primary" to="/">
        Kembali ke Dashboard
      </NavLink>
    </div>
  );
}
