/** The version in package.json, stamped from the release tag on release builds. */
declare const __APP_VERSION__: string;

declare module 'markdown-it-task-lists' {
  import type { MarkdownIt } from 'markdown-it';
  const plugin: (
    md: MarkdownIt,
    options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean },
  ) => void;
  export default plugin;
}

declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
