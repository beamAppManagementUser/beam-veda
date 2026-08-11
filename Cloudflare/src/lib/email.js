// Cloudflare Workers can't open raw SMTP connections, so nodemailer
// (the spec's original choice) doesn't work here. Resend's HTTP API is
// the swap agreed on in chat — free tier covers a low-volume "email me
// this report" feature comfortably.

export async function sendEmail(env, { to, subject, html, replyTo }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY secret is not set");
  const payload = {
    from: env.EMAIL_FROM || "Beam Veda <onboarding@resend.dev>",
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (replyTo) payload.reply_to = replyTo;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Resend API error (${resp.status}): ${detail}`);
  }
  return resp.json();
}
