import { useMemo } from 'react';
import { emptyNote } from '@/domain/notes';
import { closeNote, readNotes, useNotesUi } from '@/app/notes';
import { NoteForm } from './NoteForm';
import './notes.css';

/** Floating note editors: the one for an open note, and quick capture from anywhere. */
export function NoteHost() {
  const openId = useNotesUi((s) => s.openId);
  const quick = useNotesUi((s) => s.quick);
  const note = useMemo(
    () => {
      const all = readNotes();
      return openId ? [...all.live, ...all.trashed].find((n) => n.id === openId) : undefined;
    },
    // Only the note being opened matters; the editor owns its text while it is open.
    [openId],
  );
  return (
    <>
      {openId && note && (
        <NoteForm
          key={openId}
          id={openId}
          variant="dialog"
          focus="body"
          initial={note}
          editedAt={note.updatedAt}
          onClose={closeNote}
        />
      )}
      {quick && (
        <NoteForm
          key={`quick-${quick}`}
          variant="dialog"
          focus="title"
          initial={{
            ...emptyNote(),
            items: quick === 'list' ? [{ text: '', done: false }] : null,
          }}
          onClose={() => useNotesUi.setState({ quick: null })}
        />
      )}
    </>
  );
}
