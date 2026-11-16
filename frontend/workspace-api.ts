import { createContext, useContext } from 'react';
import { api } from './api';

export const ScopedApi = createContext<typeof api>(api);
export const WorkspaceId = createContext<string | undefined>(undefined);

export function useScopedApi() {
  return useContext(ScopedApi);
}

export function useWorkspaceExport() {
  const workspaceId = useContext(WorkspaceId);
  return (path: string) =>
    '/api' +
    path +
    (workspaceId ? '?workspace=' + encodeURIComponent(workspaceId) : '');
}
