the fresh-pins release. Deck learns to update itself, and every plugin a fresh install receives is finally current.

### Bundled apps

- deck 1.0.5: `deck update` now resolves releases from the apps monorepo by tag prefix, so a small deck fix can ship to a machine in minutes without a full mattstack release; it had silently pointed at the retired standalone repo. Plus a dev-mode badge alignment fix (#341)

### Plugin marketplace

- refreshed the catalog's plugin pins: the mattstack skills plugin was 263 commits stale and the fast-browser plugin 30, so fresh installs were getting a months-old plugin layer (#342)

### Release process

- the release skill now audits every vendored layer (bundled apps, plugin catalog, standalone apps, tool pins, the Chrome extension) instead of only the app rows, and gains a pin-only fast path for serve-only apps (#340, #343)

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.10.1...v2.10.2
