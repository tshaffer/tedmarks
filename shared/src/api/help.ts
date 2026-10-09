import { z } from 'zod';

/** One earlier question and its answer, for follow-ups ("and on the phone?"). */
export const HelpTurn = z.object({ question: z.string(), answer: z.string() });
export type HelpTurn = z.infer<typeof HelpTurn>;

/** POST /ai/help — a question about using Tedmarks, answered from the help topics. */
export const HelpAskRequest = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(HelpTurn).max(20).default([]),
});
export type HelpAskRequest = z.infer<typeof HelpAskRequest>;

export const HelpAskResponse = z.object({
  /** Markdown. */
  answer: z.string(),
  /** Slugs of the topics the answer drew on, most relevant first. */
  topics: z.array(z.string()),
});
export type HelpAskResponse = z.infer<typeof HelpAskResponse>;
