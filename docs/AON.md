# AON, the assistant in My Doc

AON helps you find, write and organize inside your own documents. It uses the AI key from Settings (your own key, or the shared allowance when sharing is set up; see [SHARING.md](SHARING.md)). Without a key, AON shows how to add one and nothing else happens.

## What it does

- **`@aon` in a document.** Type `@aon` and what you want anywhere in a Markdown or text document, then press Enter. AON writes its answer under the line, streaming. **Accept** (or Ctrl+Enter) replaces the request with the text, **Retry** asks again, **Discard** (or Esc) removes the suggestion. The file is not changed until you accept, and Ctrl+Z undoes an accepted suggestion. To write the words literally, type `\@aon`.
- **Write or rewrite from the ribbon.** The sparkle button (source mode) offers: Ask AON, Continue writing, and, for a selection, Improve writing, Fix spelling and grammar, Make shorter or longer, tone changes, Summarize, Turn into checklist or table, and Translate. Results use the same preview.
- **AON chat** (Ctrl+J, or "Ask AON" in the command palette). Ask where something is, what you decided, what is due. AON searches your workspace on this device, reads only the documents it needs, and answers with buttons that open its sources. It can create a note or checklist, with a reminder, from a sentence ("remind me Friday 9:00 to call the plumber"); each created note has an Undo that moves it to Trash.
- **AON.md.** A normal Markdown file that AON reads with every request. `AON.md` at the top level holds standing instructions (language, tone, projects, names). `AON.md` inside a folder adds rules for documents in that folder. "Edit what AON remembers" in the command palette creates and opens it.
- **Private folders.** Start a folder's `AON.md` with `private: true` between `---` lines and AON will not read, search or send anything in that folder, and `@aon` there explains why it does nothing.

## Meetings, tidy-up, capture, links and the daily brief

- **Meeting minutes.** In the sparkle menu, "Meeting minutes from these notes" turns the selected notes (or the whole document) into Summary, Decisions, Action items (`- [ ] task — owner — due date`, with `?` where something is not stated) and Open questions, as a suggestion below the notes. After you accept, "Add reminders for action items" asks AON in the chat to create a reminder note for each action item that has a date and to list the ones that do not.
- **Tidy up** (command palette, or Home). AON reads file names and the start of each document and proposes moves, clearer names and tags. You see a checklist, untick what you do not want and apply. "Undo all" puts every applied change back. AON never proposes deleting, and leaves `Notes`, `Templates`, `assets`, `AON.md` and private folders alone.
- **Capture** (command palette, or Home). Paste text or add a text, PowerPoint or OpenDocument file. AON writes a clean document with a title, folder and tags, and you edit all of it before it is saved.
- **Suggested links** (details panel, Links tab). "Find notes worth linking" asks AON to pick from related candidates found on your device. "Add link under Related" adds `[[Name]]` to a `## Related` list at the end of the document.
- **Daily brief** (Home). "Get my brief" writes a short summary of what is due, which tasks are open and what changed in the last days. It is written when you ask and kept for the day.
- In chat, AON can also list open checklist items (`tasks`) and documents with no links (`orphans`).

## What AON can change

| Action                                  | How                             |
| --------------------------------------- | ------------------------------- |
| Search, read, answer                    | Automatic; sources are shown    |
| Create a note or reminder               | Automatic, with Undo            |
| Insert or rewrite text in the open file | Only after you press Accept     |
| Edit, move, delete other documents      | Not possible in this version    |
| Anything outside the app                | Not possible (no email, no web) |

## What is sent where

Only the text a request needs goes to the AI provider (for tidy-up, capture, links and the brief that means file names, the start of documents, and the text you give it): the surrounding part of the open document for `@aon` (up to about 24,000 characters), the selection for a rewrite (up to 20,000), and for chat your question, the last few messages, and the search results and documents AON asked for. With your own key, requests go straight from your browser to your provider. With the shared key they pass through the Worker, which counts tokens but does not store text. Text inside your documents is passed to the model as data, never as instructions, and AON cannot edit documents on its own, which limits what a hostile document could do.

## Limits

- Capture reads text, PowerPoint and OpenDocument files; photos and PDFs are not supported (the AI call carries text only).
- Tidy-up looks at up to 120 of your most recently changed documents, and proposes at most 30 changes.
- "What changed since I last opened this" is not included yet.
- Only the source editor supports `@aon` and the ribbon menu. Rich view, the notes composer and sheets do not yet.
- Streaming works with your own key. The shared key returns the whole answer at once.
- Reminders AON creates behave like any note reminder: they show while My Doc is open.
- AON reads saved text. A document you just changed is read as of its last save (about a second after typing).
- Answers can be wrong. Check the sources AON shows.
