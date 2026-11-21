/**
 * Application shell + route table. FROZEN integration file (lead-owned).
 *
 * Lane owners: create `apps/web/src/features/<area>/<Page>.tsx` exporting a default
 * component, then message the Lead to register it here. Optionally export `navEntries`
 * from `features/<area>/nav.ts` and import it below.
 */

import React, { Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { STAGE_META, type QaStage } from '@qatools/shared';
import { ProjectProvider, useProject } from './lib/project';
import { toast, useToasts } from './lib/toast';
import { Loading, ErrorBox } from './components';
import NotFoundPage from './pages/NotFound';

/* ----------------------------- lane page imports ----------------------------- */
// Lane A — document creation
import ProjectsPage from './features/projects/ProjectsPage';
import RequirementsPage from './features/usecases/RequirementsPage';
import UseCasesPage from './features/usecases/UseCasesPage';
import ScenariosPage from './features/scenarios/ScenariosPage';
import TestCasesPage from './features/testcases/TestCasesPage';
import MatrixPage from './features/matrix/MatrixPage';
import SiteAnalyzerPage from './features/usecases/SiteAnalyzerPage';
// Lane B — QA project management
import DashboardPage from './features/dashboard/DashboardPage';
import CyclesPage from './features/cycles/CyclesPage';
import RegressionPage from './features/regression/RegressionPage';
import MetricsPage from './features/metrics/MetricsPage';
import DefectsPage from './features/defects/DefectsPage';
import EnvironmentPage from './features/environment/EnvironmentPage';
import RunsPage from './features/cycles/RunsPage';
// Lane C — automation engines
import ApiTesterPage from './features/apitester/ApiTesterPage';
import DbTesterPage from './features/dbtester/DbTesterPage';
import WebTesterPage from './features/webtester/WebTesterPage';
import ExecutePage from './features/execute/ExecutePage';
// Lane D — AI
import AiStudioPage from './features/ai/AiStudioPage';
import AiSettingsPage from './features/ai/AiSettingsPage';
// Lane F/G — automation codegen + agent pool (v1.2)
import CodegenPage from './features/codegen/CodegenPage';
import AgentPoolPage from './features/agents/AgentPoolPage';
// Lane E — learning
import CurriculumPage from './features/learn/CurriculumPage';
import CoursePage from './features/learn/CoursePage';
import CertificatePage from './features/certificate/CertificatePage';
import VerifyPage from './features/certificate/VerifyPage';
import MyLearningPage from './features/learn/MyLearningPage';

interface NavDef {
  group: string;
  stage: QaStage | 'overview' | 'learn';
  items: Array<{ to: string; label: string; icon: string }>;
}

/** Sidebar order mirrors the QA lifecycle — the product's spine. */
const NAV: NavDef[] = [
  {
    group: 'Ikhtisar',
    stage: 'overview',
    items: [
      { to: '/', label: 'Dashboard', icon: '🏠' },
      { to: '/projects', label: 'Projects', icon: '📁' },
    ],
  },
  {
    group: '1–2 · Kebutuhan & Use Case',
    stage: 'requirements',
    items: [
      { to: '/requirements', label: 'Requirements', icon: '📋' },
      { to: '/usecases', label: 'Use Cases', icon: '📘' },
      { to: '/site-analyzer', label: 'Analyzer Web Existing', icon: '🔍' },
    ],
  },
  {
    group: '3–5 · Skenario → Matrix',
    stage: 'scenarios',
    items: [
      { to: '/scenarios', label: 'Scenarios', icon: '🧭' },
      { to: '/testcases', label: 'Test Cases', icon: '🧪' },
      { to: '/matrix', label: 'Traceability Matrix', icon: '🔗' },
    ],
  },
  {
    group: '6–7 · Manajemen Proyek QA',
    stage: 'planning',
    items: [
      { to: '/cycles', label: 'Cycle & Sprint', icon: '🗂️' },
      { to: '/runs', label: 'Test Runs', icon: '📝' },
      { to: '/environment', label: 'Environment & Data', icon: '🖥️' },
    ],
  },
  {
    group: '8 · Eksekusi',
    stage: 'execution',
    items: [
      { to: '/execute', label: 'Run Center', icon: '▶️' },
      { to: '/api-tester', label: 'API Automation', icon: '🔌' },
      { to: '/db-tester', label: 'Database Testing', icon: '🗄️' },
      { to: '/web-tester', label: 'Web Automation', icon: '🌐' },
      { to: '/codegen', label: 'Code Generator', icon: '🏗️' },
      { to: '/agents', label: 'AI Agent Pool', icon: '🤖' },
    ],
  },
  {
    group: '9 · Defect',
    stage: 'defects',
    items: [{ to: '/defects', label: 'Defect Tracker', icon: '🐞' }],
  },
  {
    group: '10–12 · Regresi, Release, Metrik',
    stage: 'regression',
    items: [
      { to: '/regression', label: 'Regresi (King)', icon: '👑' },
      { to: '/metrics', label: 'QA Metrics', icon: '📊' },
    ],
  },
  {
    group: 'AI',
    stage: 'execution',
    items: [
      { to: '/ai', label: 'AI Studio', icon: '✨' },
      { to: '/ai/settings', label: 'AI Settings', icon: '⚙️' },
    ],
  },
  {
    group: 'Belajar & Sertifikat',
    stage: 'learn',
    items: [
      { to: '/learn', label: 'Kurikulum QA', icon: '🎓' },
      { to: '/my-learning', label: 'Learning Saya', icon: '📈' },
      { to: '/certificate', label: 'e-Certificate', icon: '🏅' },
      { to: '/verify', label: 'Verifikasi Sertifikat', icon: '✅' },
    ],
  },
];

function Sidebar() {
  const { projects, project, projectId, selectProject } = useProject();
  const { pathname } = useLocation();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">Q</div>
        <div>
          <div className="sidebar-title">QATools</div>
          <div className="sidebar-sub">QA Platform</div>
        </div>
      </div>

      <div style={{ padding: 'var(--space-3) var(--space-3) 0' }}>
        <span className="label">Project Aktif</span>
        <select
          className="select input-sm"
          value={projectId ?? ''}
          onChange={(e) => selectProject(e.target.value)}
          disabled={!projects.length}
        >
          {projects.length === 0 ? <option value="">— belum ada —</option> : null}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
        {project?.target_url ? (
          <div className="mute-sm truncate" style={{ marginTop: 4 }} title={project.target_url}>
            🔗 {project.target_url}
          </div>
        ) : null}
      </div>

      <nav className="sidebar-nav">
        {NAV.map((group) => (
          <div key={group.group}>
            <div className="nav-group">{group.group}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `nav-item ${isActive || (item.to !== '/' && pathname.startsWith(item.to)) ? 'active' : ''}`
                }
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function Topbar() {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('qatools.theme') as 'dark' | 'light') ?? 'dark',
  );
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    localStorage.setItem('qatools.theme', theme);
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    void check();
    const t = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <header className="topbar">
      <span className="strong">Platform Quality Assurance End-to-End</span>
      <span className="spacer" />
      <span
        className={`badge ${online === null ? 'badge-muted' : online ? 'badge-ok' : 'badge-err'}`}
        title={online ? 'API terhubung' : 'API tidak terjangkau'}
      >
        {online === null ? '…' : online ? '● API Online' : '● API Offline'}
      </span>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title="Ganti tema"
      >
        {theme === 'dark' ? '🌙' : '☀️'}
      </button>
    </header>
  );
}

function ToastHost() {
  const items = useToasts();
  if (!items.length) return null;
  return (
    <div className="toast-host">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone === 'info' ? 'ok' : t.tone}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

/** Blocks pages until a project exists — most features need one. */
function RequireProject(props: { children: React.ReactNode }) {
  const { projectId, loading, error, reload } = useProject();
  if (loading) return <Loading label="Memuat project…" />;
  if (error) return <ErrorBox error={error} onRetry={() => void reload()} />;
  if (!projectId) {
    return (
      <div className="empty">
        <div className="empty-icon">📁</div>
        <div className="empty-title">Belum ada project</div>
        <p className="empty-sub">
          Buat project QA pertama Anda untuk memulai alur: kebutuhan → use case → skenario → test case →
          matrix → eksekusi → regresi → rilis.
        </p>
        <NavLink className="btn btn-primary" to="/projects">
          Buat Project
        </NavLink>
      </div>
    );
  }
  return <>{props.children}</>;
}

/** Route wrapper: a lane page that fails to load shows an error, not a white screen. */
function Page(props: { children: React.ReactNode; needProject?: boolean }) {
  const body = (
    <Suspense fallback={<Loading />}>
      {props.needProject ? <RequireProject>{props.children}</RequireProject> : props.children}
    </Suspense>
  );
  return <div className="content">{body}</div>;
}

export default function App() {
  return (
    <ProjectProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="main">
          <Topbar />
          <Routes>
            <Route path="/" element={<Page needProject><DashboardPage /></Page>} />
            <Route path="/projects" element={<Page><ProjectsPage /></Page>} />

            <Route path="/requirements" element={<Page needProject><RequirementsPage /></Page>} />
            <Route path="/usecases" element={<Page needProject><UseCasesPage /></Page>} />
            <Route path="/site-analyzer" element={<Page needProject><SiteAnalyzerPage /></Page>} />
            <Route path="/scenarios" element={<Page needProject><ScenariosPage /></Page>} />
            <Route path="/testcases" element={<Page needProject><TestCasesPage /></Page>} />
            <Route path="/matrix" element={<Page needProject><MatrixPage /></Page>} />

            <Route path="/cycles" element={<Page needProject><CyclesPage /></Page>} />
            <Route path="/runs" element={<Page needProject><RunsPage /></Page>} />
            <Route path="/environment" element={<Page needProject><EnvironmentPage /></Page>} />

            <Route path="/execute" element={<Page needProject><ExecutePage /></Page>} />
            <Route path="/api-tester" element={<Page needProject><ApiTesterPage /></Page>} />
            <Route path="/db-tester" element={<Page needProject><DbTesterPage /></Page>} />
            <Route path="/web-tester" element={<Page needProject><WebTesterPage /></Page>} />
            <Route path="/codegen" element={<Page needProject><CodegenPage /></Page>} />
            <Route path="/agents" element={<Page needProject><AgentPoolPage /></Page>} />

            <Route path="/defects" element={<Page needProject><DefectsPage /></Page>} />
            <Route path="/regression" element={<Page needProject><RegressionPage /></Page>} />
            <Route path="/metrics" element={<Page needProject><MetricsPage /></Page>} />

            <Route path="/ai" element={<Page needProject><AiStudioPage /></Page>} />
            <Route path="/ai/settings" element={<Page><AiSettingsPage /></Page>} />

            <Route path="/learn" element={<Page><CurriculumPage /></Page>} />
            <Route path="/learn/:courseId" element={<Page><CoursePage /></Page>} />
            <Route path="/my-learning" element={<Page><MyLearningPage /></Page>} />
            <Route path="/certificate" element={<Page><CertificatePage /></Page>} />
            <Route path="/verify" element={<Page><VerifyPage /></Page>} />
            <Route path="/verify/:code" element={<Page><VerifyPage /></Page>} />

            <Route path="*" element={<Page><NotFoundPage /></Page>} />
          </Routes>
        </div>
      </div>
      <ToastHost />
    </ProjectProvider>
  );
}
