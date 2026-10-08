# Kahon

A team task manager in the spirit of Asana. Projects hold sections, sections hold tasks, and every task is a box you can assign, date, prioritize, break into subtasks and discuss.

Built with **React (Vite)**, **Supabase** (Postgres, Auth, Realtime) and deployed on **Vercel**.

## Features

- Email and password accounts
- Projects with a color, owner and members (owner adds teammates by email)
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

## Project structure

```
supabase/schema.sql        Tables, RLS policies, RPC functions, realtime
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
- **Adding members** calls `add_member_by_email`, which only the owner can run and which only finds people who already have an account.

## Ideas for next steps

- Email invites for people without an account (Supabase `inviteUserByEmail` via an Edge Function)
- Task search and filters (assignee, priority, due)
- Attachments with Supabase Storage
- Notifications when you're assigned or mentioned
- Timeline / calendar view
