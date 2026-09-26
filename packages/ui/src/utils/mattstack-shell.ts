/** WKWebView UA suffix appended by the native mattstack window; leading space matters. */
const MATTSTACK_SHELL_UA_MARKER = ' mattstack-shell/';

export function isInsideMattstackShell(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.userAgent.includes(MATTSTACK_SHELL_UA_MARKER)
  );
}
