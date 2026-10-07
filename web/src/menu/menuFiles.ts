import type { MenuPage } from '../api.js';

// Turning chosen files into pages for Claude: PDFs as they are, images shrunk to a size Claude
// reads well (and that fits the request). Nothing is uploaded anywhere else.

export const MAX_PAGES = 12;
const MAX_SIDE = 2000;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BASE64 = 24 * 1024 * 1024;

export const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';

export async function toMenuPages(files: File[]): Promise<MenuPage[]> {
  if (files.length > MAX_PAGES) throw new Error(`Up to ${MAX_PAGES} files at a time.`);
  const pages: MenuPage[] = [];
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name} is too big (15 MB at most).`);
      pages.push({ mediaType: 'application/pdf', data: await base64(file) });
    } else {
      pages.push({ mediaType: 'image/jpeg', data: await shrunkJpeg(file) });
    }
  }
  if (pages.reduce((n, p) => n + p.data.length, 0) > MAX_TOTAL_BASE64) throw new Error('Those files are too big together. Try fewer pages.');
  return pages;
}

async function base64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Couldn’t read the file.'));
    reader.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

/** Any image the browser can open, as a JPEG no larger than MAX_SIDE on its longest side. */
async function shrunkJpeg(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(/heic|heif/i.test(file.type + file.name)
      ? `${file.name}: this browser can’t open HEIC photos. Export it as JPEG (or use Safari).`
      : `${file.name} isn’t an image this browser can open.`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';   // transparent screenshots read better on white
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t prepare the image.'))), 'image/jpeg', 0.85));
  return base64(blob);
}
