import { useLiveQuery } from 'dexie-react-hooks';
import { db, createBinder, renameBinder, deleteBinder } from '@/services/collection/db';
import type { Binder } from '@/services/collection/db';

export function useBinders() {
  const binders = useLiveQuery(() => db.binders.orderBy('order').toArray());
  return {
    binders: binders ?? [] as Binder[],
    isLoading: binders === undefined,
    createBinder,
    renameBinder,
    deleteBinder,
  };
}
