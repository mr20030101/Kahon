# Changelog

What changed in each release of Kahon. The newest release is at the top.

Add each change under **Unreleased** as it's made. `npm run release -- patch|minor|major`
then files them under the new version number and today's date (see `scripts/release.mjs`).

- **patch** (1.0.0 → 1.0.1): fixes only.
- **minor** (1.0.0 → 1.1.0): new features, nothing that changes how existing ones work.
- **major** (1.0.0 → 2.0.0): changes people will notice in how existing features work, or a feature removed.

Version 0.1.0 was written up afterwards from the project's history: everything deployed
before versioning was set up shipped as 0.1.0.

## Unreleased

### Added

- **Home** page: your day in one line, a week strip of what's due (pick a day to see it), **Up next** (overdue, today and this week, closable right there), **Waiting on others** (open tasks you handed off), project cards with progress and status, your @mentions, private **Notes** and a **Team pulse**. My tasks moves to `/my-tasks`. Notes need `supabase/migrations/20261009_home_notepad.sql`; until it's run, they're kept in the browser only.
- **My tasks** has List, Board and Calendar views. The list is a table with due date, project, collaborators and priority columns, grouped by due date.
- Super admins can view all workspace accounts, email/MFA status, project counts and sign-in dates from **All users**.
- Project roles: each member is a **Project admin**, **Editor**, **Commenter** or **Viewer**, chosen when adding them and changeable from **Members**. Commenters can read and comment; viewers can only read.
- People assigned to a task are notified in their inbox and by email when someone changes it (renames, completes, reschedules, moves it, and so on), as they already were for comments.

- Attached images are cleaned and compressed before upload: location and camera data (EXIF) is removed, and large photos are resized to at most 3200 px and re-encoded, so a 60 MB photo uploads as a few MB. Images up to 100 MB can be attached.
- Attachments are checked to really be the file type their name says (a renamed `.exe` or HTML file is refused), and file names are cleaned of path and hidden characters.

### Changed

- Pages use the full width of the window instead of stopping at 1400 px, so wide screens no longer leave an empty strip on the right of **My tasks**, **All users** and project lists.
- Existing members are now **Editors** and owners are **Project admins**; what they can do is unchanged. Requires running `supabase/migrations/20261009_project_roles.sql` and redeploying the `notify` function.

## 0.4.1 — 2026-10-08

### Fixed

- Lists in comments (like an Ask AI answer posted as a comment) no longer squeeze their text into a narrow column.
- **Edit** and **Delete** on a comment sit together, as do **Cancel** and **Save** while editing one.
- Ask AI's **Stop** button no longer stretches across the answer box.

## 0.4.0 — 2026-10-08

### Added

- **Forgot password** on the sign-in page: get an email link and set a new password.
- **Invite by email**: add anyone to a project, even without a Kahon account. They get an invitation email and join the project automatically when they sign up. Owners can resend or cancel invitations from the members list.
- **Sign in with Google**, once it's switched on for the workspace.
- **Search and filters** on every project: search titles, descriptions and subtasks, and filter by assignee, priority, due date and labels.
- **Labels**: create colored labels for a project (⋯ → Labels), add them to tasks, and see them on cards and rows.
- **More than one assignee**: add people under **Also assigned**. They see the task in My tasks and get notified like the main assignee.
- **Repeating tasks**: set a task to repeat daily, on weekdays, weekly, monthly or yearly. Completing it creates the next one with the due date moved on.
- **Bulk actions** in the List view: select tasks to complete, move, assign, date or delete them together.
- **Subtask details**: give subtasks an assignee and due date right from the task, and open them by clicking their name.
- **Duplicate and move tasks**: from a task's ⋯ menu, duplicate it (with subtasks and labels) or move it to another project (with subtasks, comments and attachments). Copy a link to a task too.
- **Duplicate and archive projects**: copy a project's sections, labels and open tasks into a new one, or archive a project to tuck it away without deleting anything.
- **Calendar view**: see a project's tasks by due date and drag them to another day.
- **Inbox**: notifications in Kahon when you're assigned, mentioned, added to a project, get a comment on your task, or have something due. The sidebar shows how many are unread.
- **@mentions** in comments: type @ to pick a teammate. They get notified in the Inbox and by email.
- **Due-date reminders**: a morning email and Inbox notifications for tasks due today, due tomorrow or overdue.
- **Activity history** on every task: who changed what, and when.
- **Edit comments** you wrote.
- **Formatting** in descriptions and comments: **bold**, *italic*, `code`, lists and links.
- **Light or dark theme** in Settings → Display, or follow your device.
- **Ask AI reads attachments**: the text of Word (.docx), Excel (.xlsx), OpenDocument spreadsheets, PowerPoint (.pptx), PDF and text files attached to the task (not images or older .doc/.xls/.ppt files).

### Fixed

- Notification emails and Ask AI now also require the two-factor code when it's turned on, like the rest of the app.
- If Kahon hits an unexpected error, it shows a way to reload instead of a blank page, and the error is recorded so it can be fixed.

## 0.3.0 — 2026-10-08

### Added

- **Settings**: click your name in the sidebar (or the gear) to open Settings. **Profile** has your photo, full name, job title, department or team, location, time zone, an "About me" and your avatar color. **Notifications** has the email notifications switch (it was the bell in the sidebar). **Account** lets you change your password and sign out.
- **Profile photos**: upload a photo and it replaces your initials everywhere. Photos are cropped to a square and resized automatically.
- **Teammate profiles**: click someone in a project's members list to see their role, team, local time, location and "About me".
- **Project details**: an **About** button on every project shows its description, status (On track, At risk, Off track, On hold, Complete), start and due dates, and links such as the spec, design file or repository. Owners can edit them; the status, dates and first line of the description also show under the project name.

### Changed

- Projects now open in **Board** view. Switch to List from the header; links to a list view keep working.
- **Hide completed** moved from the project header into the project's **⋯** menu, which every member can now open (color and Delete project stay owner-only). Kahon remembers the setting for each project, and a "Completed hidden · Show" chip in the header shows when it's on.
- Everyone has been given a new avatar color, spread across a wider palette of 12 so teammates are easier to tell apart. Pick your own in Settings.

### Fixed

- People can no longer change the email on their profile. Members are added by email, so a changeable one could have let someone take a teammate's place.

## 0.2.0 — 2026-10-08

### Added

- **Ask AI** in every task: one click to **Summarize** the task, suggest **Next steps** or **Suggest subtasks**, or ask your own question. The AI reads the task's details, subtasks and comments (not attachment contents) and answers as it writes. Suggested subtasks can be added in one click, and any answer can be posted as a comment. Each person can ask up to 30 times a day.
- **File previews**: Word documents (.docx), spreadsheets (.xlsx, .xls, .ods, .csv), slides (.pptx), PDFs and text files attached to a task now open in a viewer inside Kahon instead of downloading. Spreadsheets with several sheets get a tab for each. Older formats (.doc, .ppt, .odt, .odp, .rtf) still download.
- **What's new**: click the version number in the footer to see what changed in each release.
- When a newer version of Kahon is deployed while you have it open, a banner offers to reload.

## 0.1.0 — 2026-10-08

### Added

- Projects with sections and tasks, in a **List** view and a **Board** view. Tasks have an assignee, due date, priority, subtasks and comments, and changes show up live for everyone in the project.
- **My tasks**: everything assigned to you across projects.
- Drag and drop to reorder tasks and move them between sections in both views, and to reorder sections.
- **Attachments** on tasks: images, PDFs, documents, spreadsheets and slides up to 25 MB, added by browsing, dragging onto the task or pasting.
- **Email notifications** when you're assigned a task, added to a project, or someone comments on a task you're assigned to or created. Turn them off in Settings → Notifications.
- **Multiple owners**: a project owner can make other members owners too. A project always keeps at least one owner.
- Completing a task completes its subtasks.
