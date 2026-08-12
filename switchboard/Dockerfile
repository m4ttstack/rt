# Railway builds the relay from this file (service Dockerfile path:
# switchboard/Dockerfile, build context: repo root). The relay's whole runtime
# graph is switchboard/*.ts + src/peer/envelope.ts + bun builtins, so no
# `bun install` runs here -- the board's package.json has a file: dependency
# that only resolves on a dev machine and must never be part of this build.
FROM oven/bun:1-slim
WORKDIR /app
COPY switchboard/server.ts switchboard/store.ts ./switchboard/
COPY src/peer/envelope.ts ./src/peer/
CMD ["bun", "run", "switchboard/server.ts"]
