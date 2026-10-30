/** Hudhud, AON's hoopoe: which pose to show for what AON is doing. */
export const HUDHUD_STATES = [
  'idle',
  'listening',
  'thinking',
  'searching',
  'success',
  'sleeping',
] as const;
export type HudhudState = (typeof HUDHUD_STATES)[number];

export interface HudhudInput {
  /** A request is in flight. */
  busy: boolean;
  /** The request is using a tool, such as searching or reading documents. */
  usingTool: boolean;
  /** The person is typing a request. */
  typing: boolean;
  /** An answer just arrived. */
  justDone: boolean;
  /** Nothing has happened for a while. */
  inactive: boolean;
}

export function hudhudState(i: HudhudInput): HudhudState {
  if (i.busy) return i.usingTool ? 'searching' : 'thinking';
  if (i.typing) return 'listening';
  if (i.justDone) return 'success';
  return i.inactive ? 'sleeping' : 'idle';
}

/** How long the happy pose stays, and how long before Hudhud dozes off. */
export const SUCCESS_MS = 2500;
export const SLEEP_MS = 120_000;
