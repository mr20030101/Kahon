import { supabase } from './supabase';

// Profile columns the app shows next to people (avatars, member lists, comments).
export const PROFILE_BRIEF = 'id, full_name, email, color, avatar_path, job_title, department';

// Avatar backgrounds; keep in sync with handle_new_user() in supabase/schema.sql.
export const AVATAR_COLORS = [
  '#2E6F73', '#B4532A', '#5B4BB7', '#2F7D32', '#C2185B', '#1565C0',
  '#8D6E00', '#6D4C41', '#00838F', '#7B1FA2', '#D84315', '#455A64',
];

const AVATAR_SIZE = 256;

export function avatarUrl(path) {
  if (!path || !supabase) return null;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

// Crop the middle square of an image and shrink it to AVATAR_SIZE, as WebP (JPEG where
// the browser can't encode WebP). Keeps avatars small however large the original was.
async function toAvatarBlob(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  canvas.getContext('2d').drawImage(
    bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE,
  );
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.88));
  if (blob?.type === 'image/webp') return { blob, ext: 'webp', type: 'image/webp' };
  const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  return { blob: jpeg, ext: 'jpg', type: 'image/jpeg' };
}

// Uploads a new avatar for `userId` and returns its storage path. A new file name each time,
// so browsers and the CDN never show a cached old photo.
export async function uploadAvatar(file, userId) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const { blob, ext, type } = await toAvatarBlob(file);
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: type });
  if (error) throw error;
  return path;
}

export async function removeAvatarFile(path) {
  if (path) await supabase.storage.from('avatars').remove([path]);
}

// All time zones the browser knows, with the viewer's own first.
export function timeZones() {
  const all = Intl.supportedValuesOf?.('timeZone') ?? [];
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return mine && all.includes(mine) ? [mine, ...all.filter((z) => z !== mine)] : all;
}

export function localTime(timeZone) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date());
  } catch {
    return null;
  }
}
