# Sharing, live editing and the default AI key

My Doc works fully offline with no account. This optional layer adds:

- **Sign in with Google**, so documents can be shared with specific people.
- **Share links** (view or edit) that work anywhere: WhatsApp, email, a chat.
- **Live editing**: several people edit one document at once and see each other's cursors.
- **A default AI key** you provide, with a per-user monthly token limit for signed-in users. Anyone can instead enter their own key in Settings.

It needs one small backend, a Cloudflare Worker in `worker/`. Without it (or without the two build settings below) the sign-in and share buttons are simply not shown.

## What you set up (about 15 minutes)

You need a Google account and the Cloudflare account that already hosts My Doc.

### 1. Google sign-in

1. Open Google Cloud Console, create or pick a project, then **APIs & Services > OAuth consent screen**. Choose **External**, fill in the app name and your email, and **Publish** the app (otherwise only listed test users can sign in).
2. **Credentials > Create credentials > OAuth client ID**, type **Web application**.
3. Under **Authorized JavaScript origins** add `https://mydocs.doerwise.com` (and `http://localhost:5173` for local work). No redirect URI is needed.
4. Copy the **Client ID** (`...apps.googleusercontent.com`). It is not a secret.

### 2. The Worker

```bash
npx wrangler login
```

Edit `worker/wrangler.toml`:

| Setting                   | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`        | The client ID from step 1.                                             |
| `APP_ORIGINS`             | Where My Doc is served, comma separated: `https://mydocs.doerwise.com` |
| `AI_PROVIDER`, `AI_MODEL` | `anthropic` or `openai`; an empty model uses a small, cheap default.   |
| `AI_MONTHLY_TOKENS`       | Tokens (input + output) per signed-in user per calendar month.         |

Add the secrets (they are stored by Cloudflare, not in the repo):

```bash
npx wrangler secret put SESSION_SECRET -c worker/wrangler.toml   # paste any long random string
npx wrangler secret put AI_API_KEY -c worker/wrangler.toml       # optional: your default AI key
```

Deploy:

```bash
npm run worker:deploy
```

No command line? Add the repository secrets `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" token template), `CLOUDFLARE_ACCOUNT_ID`, `SESSION_SECRET` and optionally `AI_API_KEY` under GitHub > Settings > Secrets and variables > Actions, then run **Actions > Deploy Worker > Run workflow**. It deploys the Worker and sets the secrets; it also redeploys whenever `worker/` changes on `main`.

Wrangler (or the workflow log) prints the Worker's URL (`https://mydoc-api.<you>.workers.dev`). A custom domain such as `api.mydocs.doerwise.com` can be attached to the Worker in the Cloudflare dashboard if you prefer.

### 3. Tell the app where it is

In **Cloudflare Pages > your project > Settings > Environment variables** add, for production:

- `VITE_API_URL` = the Worker URL
- `VITE_GOOGLE_CLIENT_ID` = the client ID

Then redeploy the site. These two values are baked in at build time and also loosen the site's Content-Security-Policy just enough to load Google's sign-in and talk to the Worker (see `vite.config.ts`).

## How it works

- **Sign-in.** Google's sign-in button gives the browser an ID token. The Worker checks its signature against Google's public keys, its audience (your client ID), expiry and verified email, then issues its own signed 30-day session token. Nothing about a user is stored until they share or use the AI allowance.
- **Sharing.** Sharing a document creates a _room_ (a Durable Object) holding the document text and who may open it. The owner chooses link access (off, view, edit) and can invite Google accounts by email. Link access is a secret in the URL; **New link** replaces it, which ends every link already sent. Turning the link off, removing a person, or stopping sharing disconnects them immediately. The server, not the app, enforces roles: a viewer's edits are discarded.
- **Edit links** let people read without signing in, but editing needs a Google sign-in.
- **Live editing** uses Yjs over a WebSocket (the standard y-websocket protocol). Edits from every mode (source, rich, tables) go through the same editor state, so they all sync. Every collaborator also keeps a normal copy on their own device that saves as usual.
- **History.** The server records every edit with who made it. **Share > Who changed what** (or the document menu) shows a change list per person with the lines they added and removed, and a line-by-line view of who last wrote each line and when. Typing is joined into one entry, and edits by one person within 5 minutes show as one change. Anyone with access can open it; only the owner sees email addresses (others see display names). After about 3,000 recorded edits the oldest are folded into a per-character authorship snapshot: line-by-line stays exact, but the change list no longer lists those older edits. History starts when a document is shared.
- **While offline**, a shared document is read-only (it shows "Offline · read-only") and becomes editable again on reconnect. This avoids two diverging copies; it is a deliberate limit.
- **People who are invited** find the document under **Shared with me**. No email is sent (the app has no mail service), so send them the link too.
- **AI keys.** A key typed in Settings is stored only in that browser and sent only to the provider (Anthropic or OpenAI). With no key, a signed-in user's requests go through the Worker with your key; each is limited by `AI_MONTHLY_TOKENS`, counted in a per-user Durable Object (tokens are reserved before the call and corrected to the real usage after, and failed calls cost nothing). Signed-out users cannot use the default key. `src/app/ai.ts` exports `complete()` for the AI features to call.

## Local development and tests

```bash
cp worker/.dev.vars.example worker/.dev.vars
npm run worker:dev                      # Worker on http://localhost:8787
VITE_API_URL=http://localhost:8787 VITE_GOOGLE_CLIENT_ID=dev npm run dev
```

With `DEV_AUTH=1` the sign-in panel also shows a development-only "Dev sign-in" box that signs in as any email. The Worker ignores that route unless `DEV_AUTH=1`, which must never be set on a deployed Worker.

- `npm test` runs the Worker's unit tests (roles, sessions, Google token checks, quota) and the editor sync tests.
- `npm run worker:smoke` (with the dev Worker running) syncs real WebSocket clients and checks roles, revocation, persistence and the AI quota.
- `SHARING_API=http://localhost:8787 VITE_API_URL=http://localhost:8787 VITE_GOOGLE_CLIENT_ID=x npx playwright test sharing` drives two browsers through share, join, live typing, a read-only visitor and revoking the link.

## Limits

- Only text documents (Markdown, text, code, CSV) are live-shared. Word, Excel, PDF and images are not.
- A shared document is limited to about 1,000,000 characters.
- Google sign-in does not work inside the desktop and phone apps (Google requires a web origin), so sharing is hidden there; use the web version.
- There is no rate limiting beyond Cloudflare's defaults and no per-user cap on how many documents someone can share. Add Cloudflare rate-limiting rules if the site is public.
- Renaming a shared document does not rename it for the others.
