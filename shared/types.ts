export type Role = 'organizer' | 'user';
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface StoredUser extends User {
  passwordHash: string;
  createdAt: string;
}
export interface Registration {
  userId: string;
  name: string;
  status: 'confirmed' | 'waitlisted';
  sequence: number;
  createdAt: string;
}
export interface HubEvent {
  id: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  capacity: number;
  organizerId: string;
  createdAt: string;
  nextSequence: number;
  registrations: Registration[];
}
export interface Poll {
  id: string;
  question: string;
  options: string[];
  organizerId: string;
  createdAt: string;
  closed: boolean;
  votes: Record<string, number>;
}
export interface Slot {
  id: string;
  title: string;
  location: string;
  startsAt: string;
  endsAt: string;
  organizerId: string;
  createdAt: string;
  booking: { userId: string; name: string } | null;
}
export interface Activity {
  id: string;
  actorId: string;
  actorName: string;
  message: string;
  createdAt: string;
  resourceId: string;
}
export interface EventView extends Omit<
  HubEvent,
  'registrations' | 'nextSequence'
> {
  confirmedCount: number;
  waitlistCount: number;
  registration: (Registration & { position?: number }) | null;
}
export interface PollView extends Omit<Poll, 'votes'> {
  counts: number[];
  totalVotes: number;
  myVote: number | null;
}
export interface Snapshot {
  events: EventView[];
  polls: PollView[];
  slots: Slot[];
  activities: Activity[];
  database: string;
}
