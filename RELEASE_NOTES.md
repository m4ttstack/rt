The prod-readiness release. Opening mattstack.app on a Mac that had been running mattstack-dev now serves every bundled app on the first launch, boxscore ships in the bundle, the window waits for deck instead of showing a 502, and setup stops registering apps one by one.

### Bundled apps

- deck 1.1.0 serves exactly the apps the bundle ships: on every start its sweep creates, adopts or fixes the rows for board, chat, console and boxscore, creates each app's data directory, and stops serving (without deleting) anything else, so switching between mattstack and mattstack-dev never destroys the other flavor's registrations (RT-280, RT-281, RT-284, #448)
- the gitq CLI still ships and stays on your PATH; the gitq web app is no longer served by mattstack.app (RT-281, #448)
- boxscore 0.1.0 is bundled for the first time (RT-282, #448)
- board 0.1.6, chat 0.1.3 and console 0.1.3 carry their name and icon inside the bundle, so tabs are labelled on a clean install (#445, #448)
- `rt-tray/deps.lock` rows can declare `serve: { port, args }`; a row with it is a bundled app, a row without it is a tool (#442)

### Tray

- the window holds its splash until deck answers and the app list has loaded, up to 90 seconds, then shows "Can't reach deck" with the reason and a Retry button (RT-283, #446)
- a tab whose app answers a server error shows the failure overlay with a working Retry instead of a blank 502 page (RT-283, #446)

### Setup and uninstall

- `rt setup` no longer registers board, chat, console or gitq itself; deck's sweep does it on both flavors (RT-281, RT-284, #444)
- `rt uninstall` rejects arguments it does not recognise instead of running a full uninstall, and removes mattstack's apps from deck in one call (#444)

### Known issue, fixed in 2.13.1

- on a Mac that had been running mattstack-dev, a mattstack.app replaced in place can find launchd refusing to start its daemon ("alive but not serving", exit 78). The automatic heal is in 2.13.1; until then, `rt daemon uninstall && rt daemon install` clears it (RT-279)

### Developer tooling

- the clean-room VM check now fails unless deck serves exactly the bundle's apps, each healthy with its icon, and checks every `.mattstack` route (RT-284, #447)
- the dev app's build cache drops builds whose worktree is gone (#437)
- `rt release update-machine` accepts a daemon running a later main that contains the release (#438)
- the repo purity gate judges only commit messages a push would publish, with tests for the new range (#439, #441)
- `@mattstack/glance` 0.27.0 (#440)
- glitter's guarded branch header reads "checked out in another worktree" with a padlock glyph

**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.12.0...v2.13.0
