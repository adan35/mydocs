import type { EntryId } from '@/domain/types';
import type { Tree } from '@/domain/tree';
import { parseFrontMatter, stripFrontMatter } from '@/domain/frontmatter';

/** AON's memory is an ordinary Markdown file: `AON.md` at the root, or inside a folder. */
export const AON_FILE = 'AON.md';
const MAX_PER_FILE = 4000;

type Texts = ReadonlyMap<EntryId, string>;

function aonFileIn(tree: Tree, folderId: EntryId | null) {
  return tree
    .childrenOf(folderId)
    .find((e) => e.kind === 'file' && e.name.toLocaleLowerCase() === AON_FILE.toLocaleLowerCase());
}

/** Standing instructions that apply to a document: the root AON.md, then each folder's. */
export function instructionsFor(tree: Tree, texts: Texts, docId?: EntryId): string {
  const folders: (EntryId | null)[] = [
    null,
    ...(docId ? tree.ancestors(docId).map((a) => a.id) : []),
  ];
  const parts: string[] = [];
  for (const f of folders) {
    const file = aonFileIn(tree, f);
    const body = file
      ? stripFrontMatter(texts.get(file.id) ?? '')
          .body.replace(/<!--[\s\S]*?-->/g, '')
          .trim()
      : '';
    if (body) parts.push(body.slice(0, MAX_PER_FILE));
  }
  return parts.join('\n\n');
}

/**
 * A folder is private to AON when its AON.md says `private: true`. AON then neither
 * reads nor sends anything inside it. (A root AON.md can't hide the whole workspace.)
 */
export function isPrivate(tree: Tree, texts: Texts, id: EntryId): boolean {
  return tree.ancestors(id).some((folder) => {
    const file = aonFileIn(tree, folder.id);
    return !!file && parseFrontMatter(texts.get(file.id) ?? '')?.private === true;
  });
}

export const STARTER = `# How AON should help me

- Keep answers short and direct.

<!--
This file is AON's memory. AON reads it with every request; edit it any time.
Add what AON should always know: your projects, the people you work with, your language.
An AON.md inside a folder adds rules for that folder only. To keep AON out of a folder,
start that folder's AON.md with these three lines: ---, private: true, ---
-->
`;
