import { useCallback, useEffect, useRef, useState } from "react";

export interface OffsetPageAnswer<T> {
  data: T[];
  total: number;
}

/**
 * One page of a list the server pages by offset. `rows` is null until the
 * first answer, so a screen never shows "nothing here" while it loads. A page
 * a removal left empty steps back to the last page that has rows, and an
 * answer for a page or filter no longer shown is dropped. `fetchPage` changes
 * when what it lists changes (its filter); the list then starts again at its
 * first page.
 */
export function useOffsetPage<T>(fetchPage: (page: { limit: number; offset: number }) => Promise<OffsetPageAnswer<T>>, pageSize: number, onError: () => void) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<T[] | null>(null);
  const [total, setTotal] = useState(0);
  const asked = useRef(0);
  const listed = useRef(fetchPage);
  const failed = useRef(onError);
  failed.current = onError;

  if (listed.current !== fetchPage) {
    listed.current = fetchPage;
    if (page !== 1) setPage(1);
  }

  const reload = useCallback(async () => {
    const ticket = (asked.current += 1);
    try {
      const answer = await fetchPage({ limit: pageSize, offset: (page - 1) * pageSize });
      if (ticket !== asked.current) return;
      const lastPage = Math.max(1, Math.ceil(answer.total / pageSize));
      if (answer.data.length === 0 && page > lastPage) {
        setPage(lastPage);
        return;
      }
      setRows(answer.data);
      setTotal(answer.total);
    } catch {
      if (ticket === asked.current) failed.current();
    }
  }, [fetchPage, page, pageSize]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, total, page, setPage, pageCount: Math.ceil(total / pageSize), reload };
}
