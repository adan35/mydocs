# AON, the assistant in My Doc

AON helps you find, write and organize inside your own documents. It uses the AI key from Settings (your own key, or the shared allowance when sharing is set up; see [SHARING.md](SHARING.md)). Without a key, AON shows how to add one and nothing else happens.

## What it does

- **`@aon` in a document.** Type `@aon` and what you want anywhere in a Markdown or text document, then press Enter. AON writes its answer under the line, streaming. **Accept** (or Ctrl+Enter) replaces the request with the text, **Retry** asks again, **Discard** (or Esc) removes the suggestion. The file is not changed until you accept, and Ctrl+Z undoes an accepted suggestion. To write the words literally, type `\@aon`.
- **Write or rewrite from the ribbon.** The sparkle button (source mode) offers: Ask AON, Continue writing, and, for a selection, Improve writing, Fix spelling and grammar, Make shorter or longer, tone changes, Summarize, Turn into checklist or table, and Translate. Results use the same preview.
- **AON chat** (Ctrl+J, or "Ask AON" in the command palette). Ask where something is, what you decided, what is due. AON searches your workspace on this device, reads only the documents it needs, and answers with buttons that open its sources. It can create a note or checklist, with a reminder, from a sentence ("remind me Friday 9:00 to call the plumber"); each created note has an Undo that moves it to Trash.
- **AON.md.** A normal Markdown file that AON reads with every request. `AON.md` at the top level holds standing instructions (language, tone, projects, names). `AON.md` inside a folder adds rules for documents in that folder. "Edit what AON remembers" in the command palette creates and opens it.
- **Private folders.** Start a folder's `AON.md` with `private: true` between `---` lines and AON will not read, search or send anything in that folder, and `@aon` there explains why it does nothing.

## What AON can change

| Action                                  | How                             |
| --------------------------------------- | ------------------------------- |
| Search, read, answer                    | Automatic; sources are shown    |
| Create a note or reminder               | Automatic, with Undo            |
| Insert or rewrite text in the open file | Only after you press Accept     |
| Edit, move, delete other documents      | Not possible in this version    |
| Anything outside the app                | Not possible (no email, no web) |

## What is sent where

Only the text a request needs goes to the AI provider: the surrounding part of the open document for `@aon` (up to about 24,000 characters), the selection for a rewrite (up to 20,000), and for chat your question, the last few messages, and the search results and documents AON asked for. With your own key, requests go straight from your browser to your provider. With the shared key they pass through the Worker, which counts tokens but does not store text. Text inside your documents is passed to the model as data, never as instructions, and AON cannot edit documents on its own, which limits what a hostile document could do.

## Limits

- Only the source editor supports `@aon` and the ribbon menu. Rich view, the notes composer and sheets do not yet.
- Streaming works with your own key. The shared key returns the whole answer at once.
- Reminders AON creates behave like any note reminder: they show while My Doc is open.
- AON reads saved text. A document you just changed is read as of its last save (about a second after typing).
- Answers can be wrong. Check the sources AON shows.
