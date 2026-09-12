# Review: ACME-1236 compress stored cache entries in redis

Looked this over against the cache client's existing key conventions and
the eviction tests in `cache/__tests__`. Overall a contained change with
a clear win on memory... three suggestions below, none blocking.

## Findings

- Compressed entries share a key prefix with the uncompressed ones, so a
  rollback would read gzip bytes as JSON. A `z:` prefix keeps the two
  generations apart.
- The 512-byte compression threshold is a literal in two places; one
  constant in `cache/config.ts` keeps them from drifting.
- No test covers eviction of a compressed entry; the existing eviction
  fixture only seeds plain values.

## Suggested constant

```ts
export const COMPRESS_ABOVE_BYTES = 512;
```

Nothing here blocks the change from landing. Happy to re-look once the
prefix is in.
