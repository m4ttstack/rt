import type { ServiceSpec } from "./manager.ts";

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The exact agent shape the matt:local-app skill has proven: RunAtLoad + KeepAlive. */
export function renderPlist(spec: ServiceSpec): string {
  const args = spec.programArguments.map((a) => `        <string>${esc(a)}</string>`).join("\n");
  const env = Object.entries(spec.environment)
    .map(([k, v]) => `        <key>${esc(k)}</key>\n        <string>${esc(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${esc(spec.label)}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>WorkingDirectory</key>
    <string>${esc(spec.workingDirectory)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${esc(spec.stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${esc(spec.stderrPath)}</string>
</dict>
</plist>
`;
}
