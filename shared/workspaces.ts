export const PROJECT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export type WorkspaceRole = 'owner' | 'manager' | 'attendee';
export type WorkspaceStatus = 'active' | 'archived' | 'deleted';
export interface WorkspaceView {
  id: string;
  name: string;
  description: string;
  category: string;
  status: Exclude<WorkspaceStatus, 'deleted'>;
  role: WorkspaceRole;
}
export interface WorkspaceMember {
  id: string;
  name: string;
  role: WorkspaceRole;
}
