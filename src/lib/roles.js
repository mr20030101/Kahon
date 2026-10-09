// Project roles. "owner" is stored in the database and shown as "Project admin".
// Keep in sync with project_members_role_check and can_edit()/can_comment() in schema.sql.
export const ROLES = [
  { value: 'owner', label: 'Project admin', description: 'Full access to change settings, modify, or delete the project.' },
  { value: 'editor', label: 'Editor', description: 'Can add, edit, and delete anything in the project.' },
  { value: 'commenter', label: 'Commenter', description: "Can comment, but can't edit anything in the project." },
  { value: 'viewer', label: 'Viewer', description: "Can view, but can't add comments or edit the project." },
];

export const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label ?? 'Member';
export const canEdit = (role) => role === 'owner' || role === 'editor';
export const canComment = (role) => canEdit(role) || role === 'commenter';
