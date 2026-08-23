import { List, Text } from '@ui/core';
import { CodeBlock } from '../../components/CodeBlock';
import { DocPage, DocSection } from '../DocPage';

const SCAFFOLD_SNIPPET = [
  '# from a checkout of this template repo:',
  'bun create-cli/create.ts <target-dir> [--workspace] [--name <package-name>]',
].join('\n');

const WORKSPACE_SNIPPET = [
  '# scaffold into an existing bun-workspace monorepo:',
  'bun create-cli/create.ts packages/ui --workspace --name @scope/ui',
].join('\n');

const TOKEN_GREP_SNIPPET = [
  'grep -rl "mattstack-console" . \\',
  '  --exclude-dir={node_modules,.git,dist,storybook-static,.superpowers}',
].join('\n');

export function ScaffoldingPage() {
  return (
    <DocPage
      title="Scaffolding"
      lead="This repo doubles as the template the create CLI scaffolds from: one command copies the template, renames it to your app, and commits a fresh git repo."
    >
      <DocSection title="The command">
        <CodeBlock code={SCAFFOLD_SNIPPET} language="bash" minHeight={66} />
        <Text size="xs" c="dimmed">
          Publishing to npm turns this into{' '}
          <code>bunx create-mattstack-console my-app</code> -- see PUBLISHING.md at
          the repo root for the runbook.
        </Text>
      </DocSection>

      <DocSection title="What one run does">
        <List size="sm" spacing={4}>
          <List.Item>
            Copies the whole template, excluding node_modules, .git, dist,
            storybook-static, and create-cli itself -- bun.lock is kept, so the
            new app installs the exact dependency versions this template was
            tested against.
          </List.Item>
          <List.Item>
            Replaces the template&apos;s name token with your app name across a
            maintained list of files (package name, page title, the site&apos;s
            header/footer branding, docs and lockfile references).
          </List.Item>
          <List.Item>
            Strips the CLI&apos;s own bin entry from the scaffolded
            package.json, forces private: true, and drops create-cli from the
            lint script (the new app has no create-cli directory).
          </List.Item>
          <List.Item>
            Runs git init and an initial commit in the target directory
            (standalone mode; --workspace leaves git to the host repo), ready to
            build.
          </List.Item>
        </List>
        <Text size="xs" c="dimmed">
          The scaffolded app keeps everything else: the @ui/* kit and its walls,
          the demo pages, tests, Storybook, and the boot-time loading
          bar/fatal-error safety net.
        </Text>
      </DocSection>

      <DocSection title="Workspace mode">
        <Text size="sm">
          --workspace scaffolds a monorepo workspace member instead of a
          standalone app; --name sets the package name (scoped names like
          @scope/ui work, and the flag is valid in both modes; the name defaults
          to the target dir&apos;s basename).
        </Text>
        <CodeBlock code={WORKSPACE_SNIPPET} language="bash" minHeight={66} />
        <List size="sm" spacing={4}>
          <List.Item>
            Skips git init, the local git identity, and the initial commit --
            the host repo owns git.
          </List.Item>
          <List.Item>
            Skips bun.lock -- the workspace root lockfile owns dependency
            resolution.
          </List.Item>
          <List.Item>
            Skips the .github directory entirely -- nested workflows never run
            in a monorepo member.
          </List.Item>
        </List>
        <Text size="xs" c="dimmed">
          Everything else ships as in standalone mode. Afterwards: make sure the
          root package.json workspaces globs match the new directory, run bun
          install at the workspace root, then bun run dev in the member. Align
          every member on one @types/node major (this kit pins ^24): an explicit
          major in one member can split hoisting when others rely on a
          transitive @types/node, producing duplicate-type errors.
        </Text>
      </DocSection>

      <DocSection title="Maintaining the token list">
        <Text size="sm">
          create-cli/create.ts keeps an explicit TOKEN_FILES list of every file
          that carries the template&apos;s literal name as text, so the scaffold
          can replace it. If you add a template file that embeds the name,
          re-run the grep below against the repo root and add any new hit to
          that list -- otherwise a scaffolded app carries a stray template-name
          string in that file.
        </Text>
        <CodeBlock code={TOKEN_GREP_SNIPPET} language="bash" minHeight={66} />
        <Text size="xs" c="dimmed">
          The CI scaffold job exercises this end-to-end: it scaffolds a probe
          app, installs, typechecks, builds, tests, and runs the de-brand gate
          against it, so a forgotten TOKEN_FILES entry fails there too.
        </Text>
      </DocSection>
    </DocPage>
  );
}
