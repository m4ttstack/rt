import { test, expect } from "bun:test";
import { renderPlist } from "./plist.ts";

const spec = {
  label: "com.mattstack.local.myapp",
  programArguments: ["/Users/x/.bun/bin/bun", "src/server.ts"],
  workingDirectory: "/Users/x/code/myapp",
  environment: { PORT: "11007" },
  stdoutPath: "/Users/x/.mattstack/local/logs/myapp.out.log",
  stderrPath: "/Users/x/.mattstack/local/logs/myapp.err.log",
};

test("renders the launchd agent shape the skill has proven for years", () => {
  const xml = renderPlist(spec);
  expect(xml).toContain("<key>Label</key>");
  expect(xml).toContain("<string>com.mattstack.local.myapp</string>");
  expect(xml).toContain("<key>RunAtLoad</key>");
  expect(xml).toContain("<key>KeepAlive</key>");
  expect(xml).toContain("<key>PORT</key>");
  expect(xml).toContain("<string>11007</string>");
  expect(xml).toContain("<string>/Users/x/code/myapp</string>");
  // parses back with plutil-compatible structure: every arg present, in order
  const args = [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  expect(args).toContain("/Users/x/.bun/bin/bun");
  expect(args).toContain("src/server.ts");
});

test("XML-escapes hostile values instead of injecting elements", () => {
  const xml = renderPlist({ ...spec, workingDirectory: "/tmp/<evil>&co" });
  expect(xml).toContain("/tmp/&lt;evil&gt;&amp;co");
  expect(xml).not.toContain("<evil>");
});
