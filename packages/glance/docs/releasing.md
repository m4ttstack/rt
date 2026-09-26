# Releasing @mattstack/glance and @mattstack/glance-react

glance is consumed inside this repo as `workspace:*` and glance-react has
no in-repo consumer yet; a publish exists only for a consumer outside it.
Publish from a checkout on `main`,
from the package directory, with `bun publish` and never `npm publish`:
glance-react depends on glance as `workspace:*`, which bun rewrites to the
version in the tree and npm ships verbatim.

1. Bump `version` in the package's `package.json` and add a CHANGELOG entry.
2. `bun run build` in the package, then `bun run check-types`.
3. `bun publish` (OTP prompt). For glance-react, glance's current version must
   already be on npm: `npm view @mattstack/glance@<version> version`.
4. Commit the bump: `glance: publish <version>`.
