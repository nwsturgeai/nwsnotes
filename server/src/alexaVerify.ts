import { X509Certificate, verify } from "node:crypto";
import { rootCertificates } from "node:tls";
import { alexaCertUrlIsAmazons } from "@nwsnotes/shared";
import type { AlexaConfig } from "./config.js";

/** The name Amazon's signing certificate must have. */
const ALEXA_CERT_NAME = "echo-api.amazon.com";
/** A request's timestamp must be within this long of now, as Amazon requires. */
const TIMESTAMP_TOLERANCE_MS = 150 * 1000;
/** How long fetching a certificate chain may take: Alexa waits 8 seconds for the whole answer. */
const FETCH_TIMEOUT_MS = 4000;
/** Bigger than any real certificate chain. */
const CHAIN_MAX_BYTES = 64 * 1024;

/** A certificate chain that's been checked: its first certificate's key, and when to check it again. */
interface CheckedChain {
  key: X509Certificate["publicKey"];
  expires: number;
}

/** Each certificate in a PEM file, in order. */
function certificatesIn(pem: string): X509Certificate[] {
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)].map((match) => new X509Certificate(match[0]));
}

/** Whether a certificate is in date now. */
function inDate(cert: X509Certificate, now: number): boolean {
  return Date.parse(cert.validFrom) <= now && now <= Date.parse(cert.validTo);
}

/**
 * Checks that requests come from Alexa, as Amazon requires of skills hosted outside AWS Lambda (see
 * "Checking it's Alexa" in Specs/alexa.md): the certificate chain's address, the chain itself, the
 * signature of the request's body, and the request's time. The skill's ID is checked by the caller.
 */
export class AlexaVerifier {
  /** Chains already checked, by address, until their first certificate expires. */
  private readonly chains = new Map<string, CheckedChain>();
  /** The roots a chain must lead to: Node's usual ones, or (outside production) the tests' own. */
  private readonly roots: X509Certificate[];

  constructor(
    private readonly config: AlexaConfig,
    private readonly fetchChain: (url: string) => Promise<string> = defaultFetchChain,
  ) {
    this.roots = config.test
      ? certificatesIn(config.test.rootPem)
      : rootCertificates.flatMap((pem) => {
          try {
            return [new X509Certificate(pem)];
          } catch {
            return [];
          }
        });
  }

  /**
   * Why the request isn't from Alexa, or undefined when it is. `body` is the request's raw body, exactly
   * as it arrived; `timestamp` is its `request.timestamp`.
   */
  async problem(body: Buffer, chainUrl: string | undefined, signature: string | undefined, timestamp: unknown): Promise<string | undefined> {
    if (!chainUrl) return "no SignatureCertChainUrl header";
    if (!signature) return "no Signature-256 header";
    const fromTests = this.config.test !== undefined && chainUrl.startsWith(this.config.test.certUrlPrefix);
    if (!fromTests && !alexaCertUrlIsAmazons(chainUrl)) return "the certificate's address isn't Amazon's";

    const now = Date.now();
    let chain = this.chains.get(chainUrl);
    if (chain && chain.expires <= now) {
      this.chains.delete(chainUrl);
      chain = undefined;
    }
    if (!chain) {
      let pem: string;
      try {
        pem = await this.fetchChain(chainUrl);
      } catch (error) {
        return `the certificate couldn't be fetched (${error instanceof Error ? error.message : String(error)})`;
      }
      const checked = this.check(pem, now);
      if (typeof checked === "string") return checked;
      chain = checked;
      this.chains.set(chainUrl, chain);
    }

    let signed = false;
    try {
      signed = verify("sha256", body, chain.key, Buffer.from(signature, "base64"));
    } catch {
      signed = false;
    }
    if (!signed) return "the signature doesn't match the request";

    const time = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
    if (Number.isNaN(time)) return "no timestamp";
    if (Math.abs(now - time) > TIMESTAMP_TOLERANCE_MS) return "its timestamp is more than 150 seconds from now";
    return undefined;
  }

  /** Checks a certificate chain: in date, naming echo-api.amazon.com, each signed by the next, ending at a trusted root. */
  private check(pem: string, now: number): CheckedChain | string {
    let certs: X509Certificate[];
    try {
      certs = certificatesIn(pem);
    } catch {
      return "the certificate chain can't be read";
    }
    const [first] = certs;
    if (!first) return "the certificate chain is empty";
    if (!certs.every((cert) => inDate(cert, now))) return "a certificate in the chain is out of date";
    const names = (first.subjectAltName ?? "").split(",").map((name) => name.trim());
    if (!names.includes(`DNS:${ALEXA_CERT_NAME}`)) return `the certificate doesn't name ${ALEXA_CERT_NAME}`;
    for (let i = 0; i + 1 < certs.length; i++) {
      const issuer = certs[i + 1]!;
      if (!issuer.ca || !certs[i]!.checkIssued(issuer) || !certs[i]!.verify(issuer.publicKey)) {
        return "the certificate chain isn't signed in order";
      }
    }
    const last = certs.at(-1)!;
    const trusted = this.roots.some(
      (root) =>
        root.fingerprint256 === last.fingerprint256 ||
        (root.ca && inDate(root, now) && last.checkIssued(root) && last.verify(root.publicKey)),
    );
    if (!trusted) return "the certificate chain doesn't lead to a trusted root";
    return { key: first.publicKey, expires: Math.min(...certs.map((cert) => Date.parse(cert.validTo))) };
  }

  /** End-to-end tests only: forgets the certificates fetched. */
  resetForTests(): void {
    this.chains.clear();
  }
}

/** Fetches a certificate chain (a PEM file), within the time allowed. */
async function defaultFetchChain(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > CHAIN_MAX_BYTES) throw new Error("too big");
  return text;
}
