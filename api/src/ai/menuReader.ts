import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { MenuReadResponse, normalizeItemName, type MenuReadItem, type MenuReadRequest } from '@tedmarks/shared';

/** Reads dishes from menu page photos. A fake in tests. */
export interface MenuReader {
  read(request: MenuReadRequest): Promise<MenuReadItem[]>;
}

export class MenuDeclinedError extends Error {}

const MODEL = 'claude-opus-5-5';
const MAX_ITEMS = 400;

const SYSTEM_PROMPT = `You read restaurant menus from photos for Tedmarks, an app where a couple records what they ordered and how it was. The dish names you return become tappable choices when they say what they ordered, so they should read the way the menu names them.

Return every orderable dish and drink on the pages, in menu order, with the menu's own section heading for each (null if the page has none) and its price as printed (null if none). Use the dish name only — leave descriptions and ingredient lists out unless the name alone would be ambiguous ("Margherita" under Pizza is fine as is). Fix obvious capitalization, but keep the menu's spelling of foreign names. Skip things that aren't orderable, like hours, notes about allergens, or "add chicken +4" style modifiers. If the photos aren't a menu or can't be read, return an empty list.`;

/** Trims, drops blanks and repeats (same name in the same section), and caps the list. */
export function cleanMenuItems(items: MenuReadItem[]): MenuReadItem[] {
  const seen = new Set<string>();
  const cleaned: MenuReadItem[] = [];
  for (const item of items) {
    const name = item.name.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const section = item.section?.replace(/\s+/g, ' ').trim() || null;
    const key = `${normalizeItemName(section ?? '')}|${normalizeItemName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ section, name, price: item.price?.trim() || null });
    if (cleaned.length >= MAX_ITEMS) break;
  }
  return cleaned;
}

/** Claude (vision), called from the server; the images are passed through and not kept. */
export class ClaudeMenuReader implements MenuReader {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async read(request: MenuReadRequest): Promise<MenuReadItem[]> {
    const images: Anthropic.Beta.BetaContentBlockParam[] = request.pages.map((page) => ({
      type: 'image',
      source: { type: 'base64', media_type: page.mediaType as 'image/jpeg', data: page.data },
    }));
    // Streamed: a long menu can produce a lot of output.
    const stream = this.client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(MenuReadResponse) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [...images, { type: 'text', text: `Menu pages from ${request.placeName}, in order.` }],
        },
      ],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new MenuDeclinedError('Claude declined to read this menu.');
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    const parsed = MenuReadResponse.safeParse(JSON.parse(text || '{}'));
    if (!parsed.success) throw new Error(`Unreadable menu output (stop reason: ${message.stop_reason})`);
    return cleanMenuItems(parsed.data.items);
  }
}
