# Kahon

A team task manager in the spirit of Asana. Projects hold sections, sections hold tasks, and every task is a box you can assign, date, prioritize, break into subtasks and discuss.

Built with **React (Vite)**, **Supabase** (Postgres, Auth, Realtime) and deployed on **Vercel**.

## Features

- Email and password accounts
- Projects with a color and members, each with a role: **Project admin**, **Editor**, **Commenter** or **Viewer**
- Assignees hear about comments on and changes to their tasks, in the inbox and by email
- **List view** with inline editing of assignee, due date and priority
- **Board view** with drag and drop between and within sections (mouse, touch and keyboard)
- Task panel: description, subtasks, comments, section, completion
- **My tasks**: everything assigned to you across projects, grouped by Overdue, Today, Next 7 days, Later and No date
- Live updates: teammates' changes appear without refreshing
- Row level security: people only ever see projects they belong to
- Light and dark mode, responsive down to phones

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql` and run it.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. (Optional, for quick local testing) **Authentication → Providers → Email**: turn off *Confirm email* so new accounts can sign in immediately. Turn it back on for production.

## 2. Run locally

```bash
cp .env.example .env.local     # then paste your URL and anon key
npm install
npm run dev
```

Open http://localhost:5173, create an account, then create your first project.

## 3. Push to GitHub

```bash
git add .
git commit -m "Initial Kahon app"
git branch -M main
git remote add origin https://github.com/mr20030101/Kahon.git
git push -u origin main
```

## 4. Deploy to Vercel

1. In Vercel, **Add New → Project** and import `mr20030101/Kahon`.
2. Framework preset: **Vite** (build command `npm run build`, output `dist` are detected automatically).
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy.
5. Back in Supabase, **Authentication → URL Configuration**: set **Site URL** to your Vercel URL (for example `https://kahon.vercel.app`) and add it under **Redirect URLs**, so confirmation emails link to the live app.

`vercel.json` rewrites every route to `index.html`, so links like `/p/<project-id>` work on refresh.

## 5. Set up email (Resend)

Kahon sends two kinds of email, both through [Resend](https://resend.com) (free for 3,000 emails a month, 100 a day):

- **Account emails** (sign-up confirmation), sent by Supabase Auth over Resend's SMTP.
- **Notifications**: you were assigned a task, added to a project, or someone commented on a task you're assigned to or created. Sent by the `notify` Edge Function. Each person can turn these off in Settings → Notifications.

### Resend

1. Create a Resend account, then **Domains → Add Domain** and add the DNS records it shows at your domain registrar. Wait until the domain shows **Verified**. Until then Resend only delivers to your own Resend login address.
2. **API Keys → Create API Key** with **Sending access**. Copy it; it starts with `re_`.

### Account emails (Supabase SMTP)

1. Supabase → **Authentication → Emails → SMTP Settings**, turn on **Enable Custom SMTP** and fill in:

   | Field | Value |
   |---|---|
   | Sender email | `notifications@yourdomain.com` (on the verified domain) |
   | Sender name | `Kahon` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | your Resend API key |

2. **Authentication → Rate Limits**: raise **emails per hour** (the default is very low with custom SMTP; 30–100 is sensible).
3. Optional: **Authentication → Emails → Templates → Confirm signup**, set the subject to `Confirm your Kahon account` and paste `supabase/templates/confirm-signup.html` as the body (replace `YOUR-APP-URL`).

### Notifications (Edge Function)

1. Run `supabase/migrations/20261008_email_notifications.sql` in the **SQL Editor** (fresh installs get it from `schema.sql`).
   For project roles and task update notifications, also run `supabase/migrations/20261009_project_roles.sql`.
   Existing databases should also run `supabase/migrations/20261010_security_hardening.sql`.
2. Deploy the function with the Supabase CLI (`npx` downloads it; nothing to install). Your project ref is the subdomain of your Supabase URL.

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase secrets set RESEND_API_KEY=re_xxx \
     EMAIL_FROM="Kahon <notifications@yourdomain.com>" \
     APP_URL=https://kahon.vercel.app
   npx supabase functions deploy notify
   ```

`APP_URL` is used for the links and logo in emails. To test locally before deploying, set it to `http://localhost:5173`. If the function isn't deployed, the app keeps working and only logs a warning in the browser console.

## 6. Optional setup

### Sign in with Google

1. In Google Cloud Console, create an OAuth client (type **Web application**) and add
   `https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
2. Supabase → **Authentication → Sign In / Providers → Google**: turn it on and paste the client ID and secret.
3. Set `VITE_GOOGLE_SIGNIN=true` in `.env.local` and in Vercel's environment variables, then redeploy.

### Due-date reminders

The feature-pack migration schedules a daily job (01:00 UTC) with `pg_cron` that calls the
`reminders` Edge Function. Deploy it without JWT checks, since the job authenticates with a
secret kept in Supabase Vault instead:

```bash
npx supabase functions deploy reminders --no-verify-jwt
```

### Error log

Errors people hit in their browser are recorded in the `client_errors` table. Read them in
the Supabase dashboard (**Table Editor → client_errors**); they aren't readable through the app.

## Tests

```bash
npm test
```

Unit tests cover the logic that's easy to break quietly: rich text and @mentions, search and
filters, drag-and-drop ordering, version comparison, changelog parsing and the calendar grid.

## Releasing

The version lives in `package.json` and shows in the footer; clicking it inside the app opens
**What's new**, built from `CHANGELOG.md`.

1. As you make changes, describe them under **Unreleased** in `CHANGELOG.md`, grouped under
   `### Added`, `### Changed` or `### Fixed`.
2. Cut the release, picking the part to bump:
   - `npm run release -- patch` for fixes only (1.0.0 → 1.0.1)
   - `npm run release -- minor` for new features (1.0.0 → 1.1.0)
   - `npm run release -- major` for changes to how existing features work (1.0.0 → 2.0.0)

   This bumps `package.json` and `package-lock.json` and moves the Unreleased notes under the
   new version and today's date. It refuses to run with nothing under Unreleased.
3. Commit, tag and push:
   ```bash
   git commit -am "Release vX.Y.Z: short summary" && git tag vX.Y.Z
   git push && git push --tags
   ```

Every build writes `/version.json`. Tabs already open when a newer version is deployed show a
banner offering to reload.

## Project structure

```
supabase/schema.sql        Tables, RLS policies, RPC functions, realtime
supabase/migrations/       Changes to run on an existing database
supabase/functions/notify  Edge Function that sends notification emails
supabase/templates/        Supabase Auth email templates
scripts/release.mjs        Bumps the version and files the changelog (npm run release)
CHANGELOG.md               What changed in each release
src/
  lib/                     Supabase client, dates, ordering helpers
  context/                 Auth, workspace (project list), toasts
  hooks/useProject.js      Loads a project and keeps it live
  components/              Sidebar, list and board views, task panel, modals
  pages/                   Login, My tasks, Project
  styles.css               Design tokens and all styles
```

## How a few things work

- **Ordering** uses fractional positions: moving a task writes one number between its new neighbours, so only that row updates.
- **Creating a project** calls the `create_project` function, which creates the project, makes you owner and adds three starter sections in one transaction.
- **Adding members** calls `add_member_by_email` with a role, which only a project admin can run. People without an account get an invitation and join with that role when they sign up.
- **Roles** are enforced by row level security, not just the UI: `can_edit()` (admins and editors) guards tasks, sections, labels, assignees and attachments; `can_comment()` (also commenters) guards comments. Viewers can only read. `owner` in the database is "Project admin" in the app.
- **Task update notifications**: a trigger puts one "updated" item in each assignee's inbox (later changes bump it rather than adding more), and the app asks the `notify` function to email them a list of what changed, at most once per task every 10 minutes.

## Ideas for next steps

- Email invites for people without an account (Supabase `inviteUserByEmail` via an Edge Function)
- Task search and filters (assignee, priority, due)
- @mentions in comments, with notifications
- Timeline / calendar view
