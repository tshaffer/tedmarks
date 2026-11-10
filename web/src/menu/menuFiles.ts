import type { MenuPageMediaType } from '@tedmarks/shared';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { MenuReadPage } from '../api.js';

// Turning chosen files into menu pages: each is kept (stored on the server as the menu's
// picture) and sent to Claude to read. Big photos are shrunk to about 3,000 pixels on the long
// side; screenshots (PNG) and PDFs are kept as they are. What's sent for reading is smaller
// when it has to be (Claude takes images up to 5 MB, and the request has a limit).

export const MAX_PAGES = 12;
/** Photos are kept at most this big on their long side. */
const MAX_KEPT_SIDE = 3000;
const MAX_KEPT_BYTES = 40 * 1024 * 1024;
/** Bigger PDFs are read as page images instead (Chrome's Save as PDF keeps every photo full size). */
const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** A big PDF's pages, as images, at most (MenuReadRequest takes 40 pages in all). */
const MAX_PDF_PAGES = 30;
const MAX_REQUEST_PAGES = 40;
const MAX_TOTAL_BASE64 = 24 * 1024 * 1024;
/** Claude's limit for one image is 5 MB of base64; this leaves room. */
const MAX_READ_IMAGE_BYTES = 3.6 * 1024 * 1024;
const MAX_READ_SIDE = 7900;

export const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';

/** A chosen file, ready to keep and to read. */
export interface PreparedPage {
  id: string;
  name: string;
  mediaType: MenuPageMediaType;
  /** What's stored as the page. */
  file: Blob;
  pixelWidth?: number | undefined;
  pixelHeight?: number | undefined;
  /** The file, shown before saving. */
  previewUrl?: string | undefined;
  /** What's sent to Claude for this file (a big PDF is several images). */
  forReading: MenuReadPage[];
}

const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

export async function prepareMenuFiles(files: File[]): Promise<PreparedPage[]> {
  if (files.length > MAX_PAGES) throw new Error(`Up to ${MAX_PAGES} files at a time.`);
  const prepared: PreparedPage[] = [];
  for (const file of files) prepared.push(await prepare(file));
  const reading = prepared.flatMap((p) => p.forReading);
  if (reading.length > MAX_REQUEST_PAGES) throw new Error(`That's ${reading.length} pages; ${MAX_REQUEST_PAGES} at most. Try fewer files.`);
  if (reading.reduce((n, p) => n + p.data.length, 0) > MAX_TOTAL_BASE64) throw new Error('Those files are too big together. Try fewer pages.');
  return prepared;
}

/** Lets go of the previews once they're no longer shown. */
export function releasePreviews(pages: PreparedPage[]): void {
  for (const page of pages) if (page.previewUrl) URL.revokeObjectURL(page.previewUrl);
}

async function prepare(file: File): Promise<PreparedPage> {
  const id = crypto.randomUUID();
  if (file.size > MAX_KEPT_BYTES) throw new Error(`${file.name} is too big (${Math.round(file.size / 1024 / 1024)} MB; 40 MB at most).`);
  if (isPdf(file)) {
    const forReading = file.size > MAX_PDF_BYTES ? await pdfAsImages(file) : [{ mediaType: 'application/pdf', data: await base64(file) }];
    return { id, name: file.name, mediaType: 'application/pdf', file, previewUrl: URL.createObjectURL(file), forReading };
  }
  const bitmap = await open(file);
  try {
    const { width, height } = bitmap;
    const screenshot = file.type === 'image/png';
    // Kept: a screenshot as it is; a photo as a JPEG no bigger than MAX_KEPT_SIDE.
    let kept: Blob = file;
    let keptWidth = width;
    let keptHeight = height;
    if (!screenshot && !(file.type === 'image/jpeg' && Math.max(width, height) <= MAX_KEPT_SIDE)) {
      const scale = Math.min(1, MAX_KEPT_SIDE / Math.max(width, height));
      keptWidth = Math.round(width * scale);
      keptHeight = Math.round(height * scale);
      kept = await jpeg(bitmap, keptWidth, keptHeight);
    }
    // Read: the kept file if Claude takes it as it is, otherwise a smaller JPEG.
    let read = kept;
    let readType = screenshot ? 'image/png' : 'image/jpeg';
    let side = Math.min(MAX_READ_SIDE, Math.max(keptWidth, keptHeight));
    if (read.size > MAX_READ_IMAGE_BYTES || Math.max(keptWidth, keptHeight) > MAX_READ_SIDE) {
      do {
        const scale = side / Math.max(width, height);
        read = await jpeg(bitmap, Math.round(width * scale), Math.round(height * scale));
        readType = 'image/jpeg';
        side = Math.round(side * 0.75);
      } while (read.size > MAX_READ_IMAGE_BYTES && side >= 600);
    }
    return {
      id, name: file.name, mediaType: screenshot ? 'image/png' : 'image/jpeg', file: kept,
      pixelWidth: keptWidth, pixelHeight: keptHeight, previewUrl: URL.createObjectURL(kept),
      forReading: [{ mediaType: readType, data: await base64(read) }],
    };
  } finally {
    bitmap.close();
  }
}

async function open(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error(/heic|heif/i.test(file.type + file.name)
      ? `${file.name}: Chrome can’t open HEIC photos. Export it as JPEG first (in Photos: File › Export).`
      : `${file.name} isn’t an image this browser can open.`);
  }
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

async function jpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';   // transparent screenshots read better on white
  g.fillRect(0, 0, width, height);
  g.drawImage(source, 0, 0, width, height);
  return canvasBlob(canvas);
}

const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t prepare the image.'))), 'image/jpeg', 0.85));

/** pdf.js, loaded only when a PDF needs it. */
export async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return pdfjs;
}

/** A PDF too big to read as it is: each page drawn as a JPEG. */
async function pdfAsImages(file: File): Promise<MenuReadPage[]> {
  const pdfjs = await loadPdfjs();
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc: Awaited<typeof loading.promise>;
  try {
    doc = await loading.promise;
  } catch {
    throw new Error(`${file.name} couldn't be opened as a PDF.`);
  }
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new Error(`${file.name} has ${doc.numPages} pages; up to ${MAX_PDF_PAGES} for a PDF this big.`);
    const pages: MenuReadPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const canvas = await renderPdfPage(await doc.getPage(n), 2000);
      pages.push({ mediaType: 'image/jpeg', data: await base64(await canvasBlob(canvas)) });
    }
    return pages;
  } finally {
    void loading.destroy();
  }
}

/** One PDF page drawn on a canvas, at most `maxSide` pixels on its long side. */
export async function renderPdfPage(page: PDFPageProxy, maxSide: number): Promise<HTMLCanvasElement> {
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, maxSide / Math.max(natural.width, natural.height)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();
  return canvas;
}
