# glance

One client for GitHub and GitLab, behind a single set of types.

Merge requests and pull requests are the same idea wearing different API
shapes. glance hides that difference: you write against one provider
interface and it works on either forge, over REST, GraphQL, and real-time
subscriptions, so a dashboard can update when a pipeline finishes instead of
polling for it.

Part of [mattstack](https://m4tthew.dev/mattstack).

## Packages

| Package | Description |
| --- | --- |
| [`@mattstack/glance`](packages/glance) | The provider-agnostic client: types, REST/GraphQL, subscriptions, dashboard helpers. Runs on Node or Bun. |
| [`@mattstack/glance-react`](packages/glance-react) | React components and hooks for rendering merge request state: cards, rows, reviewer status, pipeline badges. |

## Install

```bash
bun add @mattstack/glance
bun add @mattstack/glance-react   # optional React layer
```

## Usage

```ts
import { createProvider } from '@mattstack/glance';

const forge = createProvider({ kind: 'gitlab', host: 'gitlab.com', token });
const dashboard = await forge.fetchMRDashboard({ project: 'group/repo' });
```

The same code against GitHub is one field different:

```ts
const forge = createProvider({ kind: 'github', host: 'github.com', token });
```

## Who uses it

[rt](https://rt.cool), [gitq](https://github.com/m4ttstack/gitq), and
[mr-board](https://github.com/m4ttstack/mr-board) all read and write merge
requests through this layer, which is why the same review state shows up in a
CLI, a board, and an editor extension without three integrations drifting
apart.

## Development

```bash
bun install
bun run build
bun run check-types
```

## License

MIT
