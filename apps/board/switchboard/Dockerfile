# Railway builds the relay from this file (service Dockerfile path:
# apps/board/switchboard/Dockerfile, build context: the apps repo root). The
# relay's whole runtime graph is switchboard/*.ts + src/peer/envelope.ts +
# bun builtins, so no `bun install` runs here -- the board's package.json has
# workspace dependencies that only resolve in the workspace and must never be
# part of this build.
FROM oven/bun:1-slim
WORKDIR /app
COPY apps/board/switchboard/*.ts ./switchboard/
COPY apps/board/src/peer/envelope.ts ./src/peer/
CMD ["bun", "run", "switchboard/server.ts"]
