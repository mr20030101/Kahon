// Shared by the Edge Functions that send email: Kahon's email layout and the Resend call.
// Secrets: RESEND_API_KEY, EMAIL_FROM, APP_URL.

export const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
export const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Kahon <onboarding@resend.dev>';
export const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');

export type Email = { subject: string; heading: string; intro: string; quote?: string; cta: string; url: string; footer?: string };

/** Sends one email through Resend; throws when it fails. */
export async function sendEmail(to: string, email: Email) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject: email.subject, html: renderHtml(email), text: renderText(email) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/** "@[Name](uuid)" mention tokens as plain "@Name". */
export const plainMentions = (text: string) => text.replace(/@\[([^\]]{1,120})\]\([0-9a-f-]{36}\)/g, '@$1');

const DEFAULT_FOOTER = 'You get these emails because you use Kahon. Turn them off in Settings, under Notifications.';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderText(e: Email) {
  return [e.heading, '', e.intro, e.quote ? `\n"${e.quote}"\n` : '', `${e.cta}: ${e.url}`, '',
    e.footer ?? DEFAULT_FOOTER].join('\n');
}

// Inline styles only: email clients ignore <style> blocks and CSS variables.
export function renderHtml(e: Email) {
  const logo = APP_URL ? `<img src="${esc(APP_URL)}/icons/icon-192.png" width="28" height="28" alt="" style="display:block;border-radius:6px" />` : '';
  const quote = e.quote
    ? `<div style="margin:18px 0 0;padding:12px 14px;border-left:3px solid #3DBE6B;background:#F4F8F5;border-radius:6px;color:#13341F;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(e.quote)}</div>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#F4F8F5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#13341F">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #D3E2D8;border-radius:12px">
      <tr><td style="padding:18px 24px;background:#13341F;border-radius:12px 12px 0 0">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:10px">${logo}</td>
          <td style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:-0.3px">Kahon</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:26px 24px 8px">
        <h1 style="margin:0;font-size:20px;line-height:1.3;color:#13341F">${esc(e.heading)}</h1>
        <p style="margin:10px 0 0;font-size:15px;line-height:1.55;color:#4A6B56">${esc(e.intro)}</p>
        ${quote}
        <p style="margin:24px 0 0"><a href="${esc(e.url)}" style="display:inline-block;padding:11px 18px;background:#15703C;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:8px">${esc(e.cta)}</a></p>
      </td></tr>
      <tr><td style="padding:22px 24px 22px;font-size:12px;line-height:1.5;color:#7A8F80">
        ${esc(e.footer ?? DEFAULT_FOOTER)}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
