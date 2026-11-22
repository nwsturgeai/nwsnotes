/**
 * Sending email (see "Emailing a tab" in Specs/text-messages.md), through Brevo's HTTP API, which goes
 * over HTTPS (port 443): DigitalOcean blocks the usual mail ports. Development and the tests never send:
 * their emails are kept in memory, for the tests to read.
 */

/** Brevo's settings, from config.json. */
export interface EmailConfig {
  /** A Brevo API key (Brevo → SMTP & API → API Keys). */
  brevoApiKey: string;
  /** The sender, on a domain authenticated in Brevo, e.g. "noreply@nwsnotes.com". */
  from: string;
  /** The sender's name, as email apps show it. */
  fromName: string;
}

export interface Email {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
}

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
/** Twilio waits about 15 seconds for an answer to a text, so the email has to be sent well within that. */
const SEND_TIMEOUT_MS = 8000;

export class Mailer {
  private sentForTests: Email[] = [];

  /** `config` missing: email isn't set up (production only). `fake`: development and the tests. */
  constructor(
    private readonly config: EmailConfig | undefined,
    private readonly fake: boolean,
  ) {}

  /** Whether emails can be sent (in development and the tests, always). */
  get enabled(): boolean {
    return this.fake || this.config !== undefined;
  }

  /** Sends the email, or throws if it couldn't be sent. */
  async send(email: Email): Promise<void> {
    if (this.fake) {
      this.sentForTests.push(email);
      return;
    }
    if (!this.config) throw new Error("Email isn't set up.");
    const response = await fetch(BREVO_SEND_URL, {
      method: "POST",
      headers: { "api-key": this.config.brevoApiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: this.config.from, name: this.config.fromName },
        to: [{ email: email.to, ...(email.toName && { name: email.toName }) }],
        subject: email.subject,
        textContent: email.text,
        htmlContent: email.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Brevo's answer says why (e.g. a wrong key, or a sender it doesn't know); it holds no secrets.
      throw new Error(`Brevo refused the email (${response.status}): ${(await response.text()).slice(0, 300)}`);
    }
  }

  /** End-to-end tests only: the emails sent to this address, oldest first. */
  emailsForTests(to: string): Email[] {
    return this.sentForTests.filter((email) => email.to.toLowerCase() === to.toLowerCase());
  }

  resetForTests(): void {
    this.sentForTests = [];
  }
}
