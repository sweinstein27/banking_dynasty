// Paging instead of scrolling: the whole game fits on one screen, so long lists turn pages.
import { useState } from "react";

export interface Pages<T> {
  items: T[];
  page: number;
  pages: number;
  prev: () => void;
  next: () => void;
}

/** One page of `items`. The page is kept in range if the list shrinks. */
export function usePages<T>(items: T[], perPage: number): Pages<T> {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(page, pages - 1);
  return {
    items: items.slice(p * perPage, (p + 1) * perPage),
    page: p,
    pages,
    prev: () => setPage(Math.max(0, p - 1)),
    next: () => setPage(Math.min(pages - 1, p + 1)),
  };
}

/** Previous and next buttons with "page 1 of 3". Renders nothing when everything fits on one page. */
export function PageTurner({ pages, label = "Page" }: { pages: Pages<unknown>; label?: string }) {
  if (pages.pages <= 1) return null;
  return (
    <div className="page-turner">
      <button className="turn" onClick={pages.prev} disabled={pages.page === 0}>Previous</button>
      <span>
        {label} {pages.page + 1} of {pages.pages}
      </span>
      <button className="turn" onClick={pages.next} disabled={pages.page === pages.pages - 1}>Next</button>
    </div>
  );
}
