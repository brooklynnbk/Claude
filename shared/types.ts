// Types shared by the server and the web app.

/** A calendar date in the user's local time zone, formatted YYYY-MM-DD. */
export type ISODate = string;

// ---------- Habits ----------

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  /** Days of the week the habit is scheduled (0 = Sunday … 6 = Saturday). Empty = every day. */
  days: number[];
  archived: boolean;
  createdAt: string;
}

export interface HabitsState {
  habits: Habit[];
  /** date → ids of habits checked off that day */
  log: Record<ISODate, string[]>;
}

// ---------- To-dos ----------

export interface Todo {
  id: string;
  title: string;
  notes?: string;
  /** Optional due date. No date = "Someday". */
  dueDate?: ISODate;
  /** Important tasks float to the top of their group. */
  starred: boolean;
  done: boolean;
  doneAt?: string;
  createdAt: string;
}

// ---------- Sticker orders ----------

export const ORDER_STATUSES = ['todo', 'making', 'packed', 'shipped'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  todo: 'To do',
  making: 'Printing',
  packed: 'Packed',
  shipped: 'Shipped',
};

export interface OrderItem {
  design: string;
  quantity: number;
  /** e.g. 3" matte vinyl */
  size?: string;
}

export interface Order {
  id: string;
  customer: string;
  /** Where the order came from: Etsy, Shopify, wholesale, market… */
  channel?: string;
  items: OrderItem[];
  dueDate: ISODate;
  status: OrderStatus;
  total?: number;
  notes?: string;
  createdAt: string;
  completedAt?: string;
}

// ---------- Health ----------

export type WeightUnit = 'lb' | 'kg';

export interface HealthProfile {
  name?: string;
  units: WeightUnit;
  age?: number;
  sex?: 'female' | 'male' | 'other';
  height?: string;
  startWeight?: number;
  goalWeight?: number;
  targetDate?: ISODate;
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  fitnessGoals?: string;
  dietaryNotes?: string;
  limitations?: string;
}

export interface WeightEntry {
  date: ISODate;
  weight: number;
}

export interface WorkoutEntry {
  id: string;
  date: ISODate;
  activity: string;
  minutes: number;
  notes?: string;
}

export interface CoachNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface HealthState {
  profile: HealthProfile;
  weights: WeightEntry[];
  workouts: WorkoutEntry[];
  notes: CoachNote[];
}

// ---------- Calendar ----------

export interface CalendarSource {
  id: string;
  name: string;
  url: string;
  color: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** All-day: YYYY-MM-DD. Timed: ISO-8601 instant (UTC). */
  start: string;
  /** All-day: exclusive end date YYYY-MM-DD. Timed: ISO-8601 instant (UTC). */
  end: string;
  allDay: boolean;
  location?: string;
  calendar: string;
  color: string;
}

export interface CalendarResponse {
  events: CalendarEvent[];
  /** Problems reaching individual sources; the rest still load. */
  errors: string[];
  connected: { links: number; icloud: boolean };
}

// ---------- Coach ----------

export interface ChatItem {
  role: 'user' | 'assistant';
  text: string;
  /** Things the coach did, e.g. "Logged 172.4 lb on Nov 2". */
  actions: string[];
}

export interface CoachState {
  configured: boolean;
  messages: ChatItem[];
}
