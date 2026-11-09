export type Role = 'organizer' | 'user' | 'admin';
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
  groupId?: string;
}
export interface EventGroup {
  id: string;
  name: string;
  capacity: number;
}
export interface GroupConfiguration {
  count: number;
  capacity: number;
  names?: string[];
  autoAssign: boolean;
  allowSelfSelection: boolean;
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
  groups?: EventGroup[];
  groupSettings?: Pick<GroupConfiguration, 'autoAssign' | 'allowSelfSelection'>;
}
export interface Poll {
  id: string;
  question: string;
  options: string[];
  organizerId: string;
  createdAt: string;
  closed: boolean;
  votes: Record<string, number>;
  settings?: PollSettings;
  entries?: PollEntry[];
  schemaVersion?: number;
}
export interface PollSettings {
  mode: 'standard' | 'signup' | 'multiple';
  optionIds: string[];
  capacities: (number | null)[];
  maxSelections: number;
  allowOrganizerVote: boolean;
  allowChanges: boolean;
  allowCancellation: boolean;
  anonymous: boolean;
  resultsVisibility: 'always' | 'after-vote' | 'after-close' | 'organizer';
  state: 'draft' | 'open' | 'closed' | 'archived';
}
export interface PollEntry {
  userId: string;
  optionId: string;
  name?: string;
  email?: string;
  createdAt: string | null;
  sequence: number;
  status: 'confirmed' | 'cancelled';
}
export interface PollInput {
  question: string;
  options: string[];
  mode?: PollSettings['mode'];
  capacities?: (number | null)[];
  maxSelections?: number;
  allowOrganizerVote?: boolean;
  allowChanges?: boolean;
  allowCancellation?: boolean;
  anonymous?: boolean;
  resultsVisibility?: PollSettings['resultsVisibility'];
  state?: 'draft' | 'open';
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
  bookings?: AppointmentBooking[];
  capacity?: number;
  bookedCount?: number;
  blocked?: boolean;
  timeZone?: string;
  scheduleId?: string;
  bookingLeadMinutes?: number;
  cancelBeforeMinutes?: number;
  maxActiveBookings?: number;
}
export interface AppointmentBooking {
  userId: string;
  name: string;
  reason: string;
  createdAt: string | null;
}
export interface ScheduleInput {
  title: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  durationMinutes: number;
  bufferMinutes: number;
  capacity: number;
  weeks: number;
  breaks: { start: string; end: string }[];
  bookingLeadMinutes: number;
  cancelBeforeMinutes: number;
  maxActiveBookings: number;
  requestId: string;
}
export interface GroupView extends EventGroup {
  members: { userId: string; name: string }[];
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
export interface PollView extends Omit<Poll, 'votes' | 'entries'> {
  counts: number[];
  totalVotes: number;
  myVote: number | null;
  mySelections: string[];
  resultsVisible: boolean;
  totalSelections: number;
  availability: { registered: number; remaining: number | null }[];
  canManage: boolean;
}
export interface Snapshot {
  events: EventView[];
  polls: PollView[];
  slots: Slot[];
  activities: Activity[];
  database: string;
}
