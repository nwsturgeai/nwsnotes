/*
 * Adding notes by Alexa (see Specs/alexa.md): the skill's spoken name, turning what Alexa heard back into
 * a command as a text would have it, Amazon's rules for the certificate address, and due dates as spoken.
 * Only imports what has no imports itself, so it can be tested on its own.
 */
import { ukClock } from "./spokenDue";

/**
 * What people call the skill: "Alexa, ask Nick Notes to …". Changing it also needs `invocationName` in
 * deploy/alexa-model.json changed to match (in lower case), and the model built again in Alexa's console.
 */
export const ALEXA_NAME = "Nick Notes";

/** The intents that carry a command's words (the `words` slot), and the command word each stands for. */
const COMMAND_WORDS: Record<string, string> = {
  AddIntent: "add",
  NewIntent: "new",
  DueIntent: "due",
  EmailTabIntent: "email tab",
};

/**
 * The command as a text would have it: the intent's command word, then what Alexa heard after it
 * ("add" + "shopping oat milk" → "add shopping oat milk"), so it's read by the same code as a text.
 * `ResetNewIntent` has no words. Undefined for any other intent.
 */
export function alexaCommandText(intent: string, words: string | undefined): string | undefined {
  if (intent === "ResetNewIntent") return "reset new";
  const command = COMMAND_WORDS[intent];
  if (command === undefined) return undefined;
  const heard = (words ?? "").trim().replace(/\s+/g, " ");
  return heard === "" ? command : `${command} ${heard}`;
}

/**
 * Whether a `SignatureCertChainUrl` is one Amazon's rules allow: https, the host s3.amazonaws.com (any
 * case), port 443 if one is given, and a path starting "/echo.api/" once ".." and "." are worked out.
 */
export function alexaCertUrlIsAmazons(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // The URL parser works out ".." and "." and lower-cases the host; the port is "" when it's 443 for https.
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === "s3.amazonaws.com" &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname.startsWith("/echo.api/")
  );
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 1st, 2nd, 3rd, 4th, … 11th, 12th, 13th, … 21st. */
function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const ending = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${ending}`;
}

/**
 * A due date as Alexa says it, in UK time: e.g. "Tuesday 25th November at 3pm", "… at 3:30pm", "… at
 * midday", "… at midnight", with the year ("Tuesday 5th January 2027 at 9am") when it isn't this year.
 */
export function spokenDueForSpeech(dueDateTime: string, now: Date = new Date()): string {
  const due = ukClock(new Date(dueDateTime));
  const year = due.year === ukClock(now).year ? "" : ` ${due.year}`;
  const date = `${WEEKDAY_NAMES[due.weekday]} ${ordinal(due.day)} ${MONTH_NAMES[due.month - 1]}${year}`;
  let time: string;
  if (due.hour === 0 && due.minute === 0) time = "midnight";
  else if (due.hour === 12 && due.minute === 0) time = "midday";
  else {
    const hour = due.hour % 12 === 0 ? 12 : due.hour % 12;
    time = `${hour}${due.minute === 0 ? "" : `:${String(due.minute).padStart(2, "0")}`}${due.hour < 12 ? "am" : "pm"}`;
  }
  return `${date} at ${time}`;
}

/** GET /api/me/alexa: whether the user's Alexa is linked. */
export type AlexaStatus = { linked: false } | { linked: true; linkedDateTime: string };

/** POST /api/me/alexa/link-code: the code to say to Alexa ("Alexa, ask Nick Notes to link <code>"). */
export interface AlexaLinkCode {
  code: string;
  /** ISO 8601, UTC. */
  expiresDateTime: string;
}
