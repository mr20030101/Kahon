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
- **Email notifications** when you're assigned a task, added to a project, or someone comments on a task you're assigned to or created. Turn them off with the bell in the sidebar.
- **Multiple owners**: a project owner can make other members owners too. A project always keeps at least one owner.
- Completing a task completes its subtasks.
