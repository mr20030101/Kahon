// Vercel Function: attachments and project files in Google Drive. See src/lib/driveFiles.js.
// Needs SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, GOOGLE_DRIVE_FOLDER_ID and either
// GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET + GOOGLE_OAUTH_REFRESH_TOKEN, or
// GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, in the Vercel project's
// environment (see src/lib/googleDrive.js). Without them, the app keeps using Supabase Storage.
import { handleFilesGet, handleFilesPost } from '../src/lib/driveFiles.js';

export function POST(request) {
  return handleFilesPost(request, process.env);
}

export function GET(request) {
  return handleFilesGet(request, process.env);
}
