'use client';

import { useCallback, useState } from 'react';

/**
 * The words leaving a box are worth writing down, or nothing where they are not.
 *
 * Two ways of leaving a box are not a rewrite. One left as it was found has nothing to say, and
 * one emptied is a cancel rather than an erasure: every field opened this way is a field the row
 * cannot be read without, so the way to be rid of the words is to write other words.
 */
export function savedWords(draft: string, value: string): string | null {
  const next = draft.trim();
  return next && next !== value ? next : null;
}

/**
 * A written field the user opens under a pencil: a draft of its own while the box is open, and a
 * save on the way out, where there is one to make.
 */
export function useEditableField(value: string, save: (next: string) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const start = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  const commit = useCallback(() => {
    const next = savedWords(draft, value);
    if (next) {
      save(next);
    }
    setEditing(false);
  }, [draft, value, save]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }, [commit]);

  return {editing, draft, setDraft, start, commit, onKeyDown};
}
