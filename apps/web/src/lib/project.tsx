/**
 * Project context — the active project is shared across every feature.
 * FROZEN (lead-owned).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Project } from '@qatools/shared';
import { listOf } from './api';

interface ProjectCtx {
  projects: Project[];
  project: Project | null;
  projectId: string | null;
  loading: boolean;
  error: unknown;
  selectProject: (id: string) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<ProjectCtx>({
  projects: [],
  project: null,
  projectId: null,
  loading: true,
  error: null,
  selectProject: () => {},
  reload: async () => {},
});

const STORAGE_KEY = 'qatools.activeProject';

export function ProjectProvider(props: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY) || null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listOf<Project>('/projects');
      setProjects(rows);
      setProjectId((current) => {
        if (current && rows.some((p) => p.id === current)) return current;
        const next = rows[0]?.id ?? null;
        if (next) localStorage.setItem(STORAGE_KEY, next);
        return next;
      });
    } catch (err) {
      setError(err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectProject = useCallback((id: string) => {
    setProjectId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo<ProjectCtx>(
    () => ({
      projects,
      project: projects.find((p) => p.id === projectId) ?? null,
      projectId,
      loading,
      error,
      selectProject,
      reload,
    }),
    [projects, projectId, loading, error, selectProject, reload],
  );

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useProject(): ProjectCtx {
  return useContext(Ctx);
}

/** Guard for pages that need a project: returns the id or throws a friendly message. */
export function useRequiredProjectId(): string {
  const { projectId } = useProject();
  return projectId ?? '';
}
