/**
 * The one redactor every credential-bearing stderr/error path in this
 * package routes through, so a credential-bearing remote
 * (`https://x-access-token:TOKEN@host/...`) or a bare token git prints back
 * in its own rejection wording (`with token glpat-…`, `token=ghp_…`) never
 * reaches a thrown message, a `--json` envelope, or a log line.
 */

/** A whole URL is redacted regardless of shape — the exact URL doesn't matter, only that no credential-bearing substring survives. */
const URL_RE = /\bhttps?:\/\/\S+/g;
const SSH_REMOTE_RE = /\bgit@\S+:\S+/g;

/**
 * git's OWN rejection wording carries a bare token outside any URL (`HTTP
 * Basic: Access denied for user 'oauth2' with token glpat-SECRET`, `using
 * token=ghp_SECRET`) — neither URL pattern above touches it. Matched by the
 * high-entropy prefix every credential rt or a forge issues actually has,
 * so this never depends on which word came before it in the sentence.
 */
const CREDENTIAL_TOKEN_RE = /\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[abpsr]-|sk-ant-)[A-Za-z0-9_-]+/g;

/** Full redaction for free-text error messages, where the exact shape doesn't matter — only that no credential-bearing substring survives. */
export function withoutUrls(message: string): string {
  return message.replace(URL_RE, "<remote>").replace(SSH_REMOTE_RE, "<remote>").replace(CREDENTIAL_TOKEN_RE, "<redacted>");
}

/** `user:password@` on any scheme, or any userinfo at all on http(s): a bare token as the username (`https://ghp_x@github.com/...`) is how forges take a token. An ssh username (`ssh://git@host/...`) is not a secret. */
const CREDENTIALED_URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@|https?:\/\/[^\s/@]+@)/i;

/** A URL whose userinfo carries a credential: never logged, never accepted as a remote. */
export function hasUrlCredentials(value: string): boolean {
  return CREDENTIALED_URL_RE.test(value);
}
