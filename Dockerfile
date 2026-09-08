# becode, for a server.
#
# Single stage on purpose. Two things make the usual slim multi-stage build wrong here:
#
#   - `agent/instructions.md`, `roles/<role>.md`, `agent/skills/*/SKILL.md` and the SDK plugin root
#     are read off disk relative to `process.cwd()` at run time, not imported. `next.config.ts` sets
#     no `output: "standalone"`, so Next traces none of them. A pruned image boots and then throws
#     on the first turn.
#   - `@anthropic-ai/claude-agent-sdk` ships its Claude Code binary as a per-platform
#     *optionalDependency*. Anything that prunes optional deps leaves the SDK with nothing to run.
#
# bookworm, not alpine: the SDK's `linux-x64` build is glibc.
FROM node:24-bookworm-slim

# git      — every worktree operation
# gh       — `open_pull_request` shells out to `gh pr create`
# lsof/ps  — `agent/lib/ports.ts` reads port holders through them; without lsof `clearPort`
#            silently decides every port is free
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg lsof procps \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Assert the tools exist now, in the build, rather than at 2am in a tool result.
RUN git --version && gh --version && lsof -v 2>&1 | head -1

RUN groupadd -g 10001 becode \
 && useradd -u 10001 -g 10001 -d /home/becode -s /bin/bash becode \
 && mkdir -p /home/becode && chown 10001:10001 /home/becode

ENV HOME=/home/becode \
    NODE_ENV=production \
    # The *target* repo pins its own pnpm through `packageManager`. Without this, the install a
    # task runs in a worktree prompts before fetching it — and `spawn` gives it no TTY, so it hangs
    # silently until the liveness check calls the app dead.
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# `/app` is created here rather than by WORKDIR, which would leave it owned by root — pnpm writes
# temp files into the project directory, so the install fails with EACCES under the service user.
RUN mkdir -p /app && chown 10001:10001 /app
WORKDIR /app
COPY --chown=10001:10001 . .

USER becode

# Never --omit=optional / --no-optional here: see the note about the SDK's native binary above.
RUN pnpm install --frozen-lockfile && pnpm build

EXPOSE 4000

# node directly, not `pnpm start`: this process must be PID 1 so its SIGTERM handler runs and reaps
# the dev servers it spawned. pnpm in between forwards signals unreliably.
#
# -H 127.0.0.1 because this container runs with host networking. `next start` would otherwise bind
# every interface, and every route under /api/ is unauthenticated. Caddy reaches it on loopback.
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "4000", "-H", "127.0.0.1"]
