import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AskRequest, AskResponse } from '@tedmarks/shared';
import { buildDigest, formatMenuHits, placeDetails, searchMenus, type AskDigest, type AskRecords } from './askData.js';
import { cleanTopics, helpContext } from './helpAnswerer.js';

/** Answers Ask Tedmarks questions. A fake in tests. */
export interface AskAnswerer {
  answer(request: AskRequest): Promise<AskResponse>;
}

const MODEL = 'claude-opus-5-5';
/** Earlier questions sent for context (follow-ups). */
const MAX_HISTORY = 6;
/** Lookups per question, at most (each is a request to Claude). */
const MAX_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are Ask Tedmarks, on the Tedmarks website. Tedmarks is a restaurant journal for a couple, Ted and Lori: an iPhone app for recording visits at the restaurant (what they ordered, how it was), and a website for planning where to eat and looking back. You're talking with Ted or Lori.

Two kinds of question come in, and you decide which:
- About their restaurants: places they've been or want to go, visits, what they ordered and how they rated it, notes, menus. Answer from the Tedmarks data below and the lookups.
- About using Tedmarks: answer from the help topics below.

The data: every place, one block each, starting with its ref in brackets ([p12]), then city, type, been there / want to go, Google's rating, price, tags, and whether we have its menu. Then its visits, newest first: date, who was there, the verdict, and each dish ordered with its rating. Ratings are "joint unless we disagree": one rating when everyone agrees, otherwise each person's ("Ted: loved it, Lori: good"). Dish ratings: loved it, good, skip it. Verdicts: would return, try again, won't return.

Lookups:
- search_menus finds dishes on the menus we've saved (names, descriptions, sections, prices), including places we haven't been to yet. Use it for "who has X on the menu", or to see a place's whole menu.
- place_details gives address, phone, website and opening hours. Use it for "open Sunday night", "where is it", and the like. Today's date and time are given with the question.

Answer only from the data, the lookups and the help topics. Don't guess: if Tedmarks doesn't have it, say so plainly. Don't invent features, buttons or behavior the topics don't describe. Keep answers short and practical: a few sentences or a short list. Use the places' names in the answer, never their refs. Use American English. Markdown is fine.

You can't change anything in Tedmarks; if asked to, say how to do it in the app.

When done, give the answer, the refs of the places the answer mentions (most relevant first, at most 8; none if it mentions none), and the slugs of the help topics you drew on (none if you didn't use the help).`;

const Answer = z.object({
  answer: z.string().describe('The answer, in Markdown.'),
  places: z.array(z.string()).describe('Refs ("p12") of the places the answer mentions, most relevant first.'),
  topics: z.array(z.string()).describe('Slugs of the help topics used.'),
});

/** "Thursday, November 12, 2026, 3:25 PM" in Pacific time (where Ted and Lori live). */
function now(): string {
  return new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Turns Claude's answer into the response: refs become places, unknown ones are dropped. */
export function toResponse(raw: z.infer<typeof Answer>, digest: AskDigest): AskResponse {
  const seen = new Set<string>();
  const places = raw.places.flatMap((ref) => {
    const place = digest.refs.get(ref.replace(/[[\]]/g, ''));
    if (!place || seen.has(place.id)) return [];
    seen.add(place.id);
    return [{ id: place.id, name: place.name, ...(place.city ? { city: place.city } : {}) }];
  }).slice(0, 8);
  return { answer: raw.answer, places, topics: cleanTopics(raw.topics) };
}

export class ClaudeAskAnswerer implements AskAnswerer {
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly load: () => Promise<AskRecords>) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async answer(request: AskRequest): Promise<AskResponse> {
    const records = await this.load();
    const digest = buildDigest(records);

    const menuTool = betaZodTool({
      name: 'search_menus',
      description: 'Search the dishes on the latest menu of every place we have a menu for: names, descriptions and sections. Returns matching dishes with their place ref, section, price and description. Give a place ref to list that place’s whole menu (the query can then be empty).',
      inputSchema: z.object({
        query: z.string().describe('Words to look for, e.g. "reuben" or "fish tacos"'),
        place: z.string().optional().describe('A place ref ("p12") to search only that place’s menu'),
      }),
      run: ({ query, place }) => formatMenuHits(searchMenus(records, digest, query, place)),
    });
    const detailsTool = betaZodTool({
      name: 'place_details',
      description: 'Address, phone, website and opening hours (from Google) for up to 20 places.',
      inputSchema: z.object({ places: z.array(z.string()).max(20).describe('Place refs, e.g. ["p12", "p40"]') }),
      run: ({ places }) => placeDetails(records, digest, places),
    });

    const history = request.history.slice(-MAX_HISTORY).flatMap((turn): Anthropic.Beta.BetaMessageParam[] => [
      { role: 'user', content: turn.question },
      { role: 'assistant', content: turn.answer },
    ]);
    const final = await this.client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 8000,
      max_iterations: MAX_ITERATIONS,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Answer) },
      tools: [menuTool, detailsTool],
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        { type: 'text', text: `# Help topics\n\n${helpContext()}` },
        // The data changes with every edit, so it goes last, cached until then.
        { type: 'text', text: `# Tedmarks data\n\n${digest.text}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: [...history, { role: 'user', content: `(Now: ${now()})\n\n${request.question}` }],
    });

    if (final.stop_reason === 'refusal') throw new AskDeclinedError();
    const text = final.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = Answer.safeParse(safeJson(text));
    if (!parsed.success) throw new Error(`No answer (stop reason: ${final.stop_reason})`);
    return toResponse(parsed.data, digest);
  }
}

export class AskDeclinedError extends Error {
  constructor() { super('Claude declined to answer'); }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}
