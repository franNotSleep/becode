/**
 * Sending the one email becode sends.
 *
 * SendGrid because the company already uses it (`@sendgrid/mail` in the tix backend), so this
 * borrows an existing key and an already-verified sender rather than introducing a provider and
 * a new deliverability problem.
 *
 * Without a key configured the code is written to the log instead. That is deliberate and it is
 * for one situation only: bringing the box up, before the mail key is in place, when being locked
 * out of the thing you are installing is a bad first experience. It announces itself loudly
 * because a production instance printing sign-in codes to stdout is a hole, not a feature.
 */
import sendgrid from "@sendgrid/mail";

const KEY = process.env.SENDGRID_API_KEY;
const FROM = process.env.SENDGRID_FROM;

let configured = false;

export async function sendCode(email: string, otp: string): Promise<void> {
  if (!KEY || !FROM) {
    console.warn(
      `becode: no SENDGRID_API_KEY/SENDGRID_FROM — sign-in code for ${email} is ${otp}. ` +
        `Anyone who can read this process's output can sign in. Configure mail before real use.`,
    );
    return;
  }

  if (!configured) {
    sendgrid.setApiKey(KEY);
    configured = true;
  }

  await sendgrid.send({
    to: email,
    from: FROM,
    subject: `${otp} is your becode sign-in code`,
    // Both parts, because a text-only body lands in spam far more often than a pair does.
    text: `Your becode sign-in code is ${otp}. It expires in 10 minutes.\n\nIf you did not ask for this, ignore it — the code is useless without your inbox.`,
    html:
      `<p style="font:16px/1.5 system-ui,sans-serif">Your becode sign-in code is</p>` +
      `<p style="font:600 32px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em">${otp}</p>` +
      `<p style="font:14px/1.5 system-ui,sans-serif;color:#666">It expires in 10 minutes. If you did not ask for this, ignore it — the code is useless without your inbox.</p>`,
  });
}
