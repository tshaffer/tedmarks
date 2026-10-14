import type { MenuPage } from '../api.js';

// Turning chosen files into pages for Claude: PDFs as they are (or, when too big, as page images),
// images shrunk to a size Claude reads well (and that fits the request). Nothing is uploaded
// anywhere else.

export const MAX_PAGES = 12;
const MAX_SIDE = 2000;
/** Bigger PDFs go as page images instead (Chrome's Save as PDF keeps every photo full size). */
const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** A big PDF's pages, as images, at most (MenuReadRequest takes 40 pages in all). */
const MAX_PDF_PAGES = 30;
const MAX_REQUEST_PAGES = 40;
const MAX_TOTAL_BASE64 = 24 * 1024 * 1024;

export const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';

export async function toMenuPages(files: File[]): Promise<MenuPage[]> {
  if (files.length > MAX_PAGES) throw new Error(`Up to ${MAX_PAGES} files at a time.`);
  const pages: MenuPage[] = [];
  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (file.size > MAX_PDF_BYTES) pages.push(...await pdfAsImages(file));
      else pages.push({ mediaType: 'application/pdf', data: await base64(file) });
    } else {
      pages.push({ mediaType: 'image/jpeg', data: await shrunkJpeg(file) });
    }
  }
  if (pages.length > MAX_REQUEST_PAGES) throw new Error(`That's ${pages.length} pages; ${MAX_REQUEST_PAGES} at most. Try fewer files.`);
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

/** A PDF too big to send as it is: each page drawn as a JPEG (pdf.js, loaded only when needed). */
async function pdfAsImages(file: File): Promise<MenuPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc: Awaited<typeof loading.promise>;
  try {
    doc = await loading.promise;
  } catch {
    throw new Error(`${file.name} couldn't be opened as a PDF.`);
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new Error(`${file.name} has ${doc.numPages} pages; up to ${MAX_PDF_PAGES} for a PDF this big.`);
    const pages: MenuPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, MAX_SIDE / Math.max(natural.width, natural.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      page.cleanup();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t prepare a page.'))), 'image/jpeg', 0.85));
      pages.push({ mediaType: 'image/jpeg', data: await base64(blob) });
    }
    return pages;
  } finally {
    void loading.destroy();
  }
}
