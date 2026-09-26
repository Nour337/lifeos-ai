// Shared by the server (lib/ai/usage.ts) and the screens.

// Points each kind of AI request costs. Keep in sync with public.ai_cost()
// in supabase/migrations/20260926120000_ai_budget.sql. Everything that
// doesn't need a model is free.
export const AI_COSTS = {
  chat: 1, // one assistant message
  now: 1, // "What should I do now?" / "I have free time"
  suggest: 1, // today's suggestions (cached for the day)
  steps: 1, // break a task into steps
  review: 2, // weekly review
  onboarding: 0, // creating your persona (capped at 60 a day)
  summarize: 0, // keeping long chats short (internal)
} as const;

export type AIKind = keyof typeof AI_COSTS;

// The default daily allowance (entitlements.daily_points)
export const DEFAULT_DAILY_POINTS = 30;

export type Budget = { remaining: number; limit: number };
