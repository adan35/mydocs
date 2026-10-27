import { create } from 'zustand';

/** The two AON dialogs (tidy-up and capture) share one slot. */
export const useAonDialog = create<{ kind: 'tidy' | 'capture' | null; seed: string }>(() => ({
  kind: null,
  seed: '',
}));

export const openTidy = () => useAonDialog.setState({ kind: 'tidy', seed: '' });
export const openCapture = (seed = '') => useAonDialog.setState({ kind: 'capture', seed });
export const closeAonDialog = () => useAonDialog.setState({ kind: null, seed: '' });
