import { z } from 'zod';
import { HelpTurn } from './help.js';

/**
 * POST /ai/ask — Ask Tedmarks: a question about our places, visits and menus, or about using
 * Tedmarks. Answered by Claude from the help topics and everything in Tedmarks.
 */
export const AskRequest = z.object({
  question: z.string().trim().min(1).max(1000),
  /** Earlier questions and answers in this conversation, for follow-ups ("which of those…"). */
  history: z.array(HelpTurn).max(20).default([]),
  /** Which app is asking: the help topics describe the website, so the iPhone app says so. */
  client: z.enum(['web', 'ios']).default('web'),
});
export type AskRequest = z.infer<typeof AskRequest>;

/** A place an answer mentions, shown as a chip that opens it. */
export const AskPlace = z.object({ id: z.string(), name: z.string(), city: z.string().optional() });
export type AskPlace = z.infer<typeof AskPlace>;

export const AskResponse = z.object({
  /** Markdown. */
  answer: z.string(),
  /** Places the answer mentions, most relevant first. */
  places: z.array(AskPlace),
  /** Slugs of help topics the answer drew on, most relevant first. */
  topics: z.array(z.string()),
});
export type AskResponse = z.infer<typeof AskResponse>;
