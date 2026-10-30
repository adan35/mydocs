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

## Sheets, voice and private mode

**Ask AON in sheets.** The sheet toolbar (Excel workbooks, CSV and TSV files, and Markdown tables) has an **Ask AON** button. Ask it to explain a formula, write one from a sentence, clean up a column, or categorize rows into a new column. AON sees the column letters and up to 120 rows (the header and your selection when the sheet is longer, up to 40 columns, 100 characters per cell) and answers with a short explanation plus a list of cell changes. You see each change as "before → after" and nothing is written until **Apply**. Applying is one undo step (Ctrl + Z). AON may only change cells in the rows it was shown, or add up to five rows under the data. CSV and TSV files hold values, so a proposed formula is left out and counted. There is deliberately no `=AON()` cell function: it would recalculate unpredictably and could spend your allowance without you noticing.

**Voice.** A microphone button in the AON chat, the new note box, the capture dialog and the sheet dialog types what you say, using the speech recognition built into your browser (Chrome, Edge and Safari have it; Firefox does not, and the button is then hidden). The first use says that some browsers send the audio to their maker's servers. My Doc itself never receives audio. Dictated text is only typed into the box, so you read it before anything happens.

**Private mode.** In Settings, AI, choose "Private: a model on this computer". AON then talks only to a model server on your own computer and nothing leaves it: no provider, no shared allowance, no saved key (the key you saved for a cloud provider is never sent). Voice typing is turned off in this mode because browsers may send audio away.

- Run any server that speaks the OpenAI chat format. For Ollama (default address `http://localhost:11434/v1`): install it, run `ollama pull llama3.2`, and start it so it accepts this site: `OLLAMA_ORIGINS=https://your-site ollama serve` (for local development `OLLAMA_ORIGINS=http://localhost:*`). LM Studio and llama.cpp have a similar "allow origin" or CORS option.
- Enter the model's name in Settings and press Test.
- Safari blocks a secure page from calling an `http://localhost` address, and Chrome may ask once to allow access to devices on your network. The address must be this computer (`localhost` or `127.0.0.1`): My Doc's security policy does not allow other addresses.
- Small local models are slower and weaker than cloud models, especially at choosing tools in chat, long documents and strict JSON (tidy-up and sheets). They fail more often; the chat panel says so, and nothing is applied without your review either way. Models that print their reasoning in `<think>` tags are handled: the thinking is not shown.
- A model that runs inside the browser itself (no server) is not included: it needs a large download and a capable GPU.

## Hudhud

Hudhud, the hoopoe, is AON's mascot. One pose per state (`src/app/aon/sprites/`): idle, listening (you are typing a request), thinking (a request is in flight), searching (AON is using a tool), success (an answer just arrived, for 2.5 seconds) and sleeping (nothing for two minutes). `hudhudState()` in `src/app/aon/hudhud.ts` maps what AON is doing to a pose; `<Hudhud>` shows it, and the motion is plain CSS (`.hudhud` in `styles.css`). It appears in the chat header and empty state, in the inline suggestion box, in the tidy-up and sheet dialogs, and as a small button in the corner when the panel is closed while AON works. Under reduced motion the poses stay still. Settings has a **Show AON** switch that hides AON everywhere (sidebar, Home, command palette, `@aon`, the editor and sheet buttons, the panel) and a **Show Hudhud** switch that keeps AON but drops the mascot. The poses are decorative (`aria-hidden`); the status is also written in words.

## What AON can change

| Action                                  | How                             |
| --------------------------------------- | ------------------------------- |
| Search, read, answer                    | Automatic; sources are shown    |
| Create a note or reminder               | Automatic, with Undo            |
| Insert or rewrite text in the open file | Only after you press Accept     |
| Edit, move, delete other documents      | Not possible in this version    |
| Anything outside the app                | Not possible (no email, no web) |

## What is sent where

In Private mode requests go only to the address you set (your own computer). Otherwise only the text a request needs goes to the AI provider (for tidy-up, capture, links and the brief that means file names, the start of documents, and the text you give it): the surrounding part of the open document for `@aon` (up to about 24,000 characters), the selection for a rewrite (up to 20,000), and for chat your question, the last few messages, and the search results and documents AON asked for. With your own key, requests go straight from your browser to your provider. With the shared key they pass through the Worker, which counts tokens but does not store text. Text inside your documents is passed to the model as data, never as instructions, and AON cannot edit documents on its own, which limits what a hostile document could do.

## Limits

- Capture reads text, PowerPoint and OpenDocument files; photos and PDFs are not supported (the AI call carries text only).
- Tidy-up looks at up to 120 of your most recently changed documents, and proposes at most 30 changes.
- "What changed since I last opened this" is not included yet.
- Only the source editor supports `@aon` and the ribbon menu. Rich view and the notes composer do not yet; sheets have their own Ask AON button.
- Sheet helper: one request covers up to 120 rows and 40 columns, so it will not clean a column of thousands of rows in one go; select the part you mean.
- Voice depends on the browser: no Firefox, and some browsers use their maker's servers.
- Streaming works with your own key. The shared key returns the whole answer at once.
- Reminders AON creates behave like any note reminder: they show while My Doc is open.
- AON reads saved text. A document you just changed is read as of its last save (about a second after typing).
- Answers can be wrong. Check the sources AON shows.
