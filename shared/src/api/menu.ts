import { z } from 'zod';

/** One menu page photo or screenshot, or a whole PDF menu — sent only for reading (never stored on the server). */
export const MenuPageImage = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/gif', 'application/pdf']),
  /** Base64 bytes. */
  data: z.string().min(1),
});

/** POST /ai/menu */
export const MenuReadRequest = z.object({
  placeName: z.string().min(1),
  pages: z.array(MenuPageImage).min(1).max(12),
});
export type MenuReadRequest = z.infer<typeof MenuReadRequest>;

/** A dish or drink read from the menu. */
export const MenuReadItem = z.object({
  /** The menu's own heading ("Pizza", "Antipasti"), when it has one. */
  section: z.string().nullable(),
  name: z.string(),
  /** As printed ("18", "$14.50", "MP"). */
  price: z.string().nullable(),
});
export type MenuReadItem = z.infer<typeof MenuReadItem>;

export const MenuReadResponse = z.object({ items: z.array(MenuReadItem) });
export type MenuReadResponse = z.infer<typeof MenuReadResponse>;

/** GET /ai/menu/jobs/:id — a menu read started with POST /ai/menu/jobs (for reads longer than a request may take). */
export const MenuReadJob = z.discriminatedUnion('status', [
  z.object({ status: z.literal('reading') }),
  z.object({ status: z.literal('done'), items: z.array(MenuReadItem) }),
  z.object({ status: z.literal('failed'), error: z.string(), message: z.string() }),
]);
export type MenuReadJob = z.infer<typeof MenuReadJob>;
