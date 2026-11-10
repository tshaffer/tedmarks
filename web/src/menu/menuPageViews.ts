import type { MenuPage } from '@tedmarks/shared';
import { useEffect, useState } from 'react';
import { menuPageUrl } from '../api.js';
import { loadPdfjs, renderPdfPage } from './menuFiles.js';

/** One page as shown: a picture, or one page of a PDF (drawn in the browser). */
export interface PageView {
  key: string;
  /** Shown in the viewer; undefined while a PDF page is still being drawn. */
  src: string | undefined;
  /** Opens the original (a PDF at this page). */
  original: string;
}

/** PDF pages drawn once per session, by page id. */
const drawn = new Map<string, Promise<string[]>>();

function drawPdf(id: string, url: string): Promise<string[]> {
  let pages = drawn.get(id);
  if (!pages) {
    pages = (async () => {
      const pdfjs = await loadPdfjs();
      const loading = pdfjs.getDocument({ url, withCredentials: true });
      const doc = await loading.promise;
      try {
        const urls: string[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const canvas = await renderPdfPage(await doc.getPage(n), 2400);
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t draw the page.'))), 'image/jpeg', 0.9));
          urls.push(URL.createObjectURL(blob));
        }
        return urls;
      } finally {
        void loading.destroy();
      }
    })();
    pages.catch(() => drawn.delete(id));
    drawn.set(id, pages);
  }
  return pages;
}

/** A page to show: stored on the server, or (before saving) a local file's URL. */
export type ShownPage = Pick<MenuPage, 'id' | 'mediaType'> & { url?: string | undefined };

/** A menu's pages, in order, with each PDF spread out into its pages. */
export function usePageViews(pages: readonly ShownPage[] | undefined): { views: PageView[]; error: string | null } {
  const [pdfs, setPdfs] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const key = (pages ?? []).map((p) => p.id).join(',');

  useEffect(() => {
    let live = true;
    for (const page of pages ?? []) {
      if (page.mediaType !== 'application/pdf') continue;
      drawPdf(page.id, page.url ?? menuPageUrl(page.id))
        .then((urls) => { if (live) setPdfs((current) => ({ ...current, [page.id]: urls })); })
        .catch(() => { if (live) setError('A PDF page couldn’t be shown.'); });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const views: PageView[] = [];
  for (const page of pages ?? []) {
    if (page.mediaType !== 'application/pdf') {
      const url = page.url ?? menuPageUrl(page.id);
      views.push({ key: page.id, src: url, original: url });
    } else {
      const urls = pdfs[page.id];
      const url = page.url ?? menuPageUrl(page.id);
      if (!urls) views.push({ key: `${page.id}#1`, src: undefined, original: url });
      else urls.forEach((src, i) => views.push({ key: `${page.id}#${i + 1}`, src, original: `${url}#page=${i + 1}` }));
    }
  }
  return { views, error };
}
