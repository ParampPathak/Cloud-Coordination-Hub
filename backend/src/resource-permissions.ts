import type { User } from '../../shared/types.js';

export function managesResource(user: User, entity: { organizerId: string }) {
  return (
    user.role === 'organizer' &&
    (user.workspaceRole === 'owner' ||
      user.workspaceRole === 'manager' ||
      (!user.workspaceRole && user.id === entity.organizerId))
  );
}
