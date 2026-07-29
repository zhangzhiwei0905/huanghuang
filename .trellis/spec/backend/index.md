# Backend Development Guidelines

> Authoritative conventions for `apps/server`, `packages/protocol`, and `packages/game-engine`.

---

## Overview

Document **what this repo actually does**. Sub-agents and future sessions load these files through task manifests — aspirational rules that are not true in code will produce mismatched patches.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module layout and dependency direction | Active |
| [Database Guidelines](./database-guidelines.md) | SQLite ownership, transactions, room retirement, backup | Active |
| [Error Handling](./error-handling.md) | HTTP vs Socket errors, CommandResult, stable codes | Active |
| [Team Ranked Matchmaking](./team-matchmaking.md) | Atomic party queueing, no-split matching, cancellation, and recovery | Active |
| [Quality Guidelines](./quality-guidelines.md) | Required checks + command/bot/settlement scenarios | Active |
| [Logging Guidelines](./logging-guidelines.md) | Fastify structured logging and redaction | Active |

## Pre-Development Checklist

When changing server or engine code, read at least:

1. [Directory Structure](./directory-structure.md) — where the change belongs
2. [Error Handling](./error-handling.md) — if any API/Socket surface changes
3. [Database Guidelines](./database-guidelines.md) — if persistence or room lifecycle changes
4. [Quality Guidelines](./quality-guidelines.md) — if commands, bots, or settlement change
5. [Team Ranked Matchmaking](./team-matchmaking.md) — if party queueing or team-ranked rooms change
6. Shared [Thinking Guides](../guides/index.md) when the change crosses layers

## Maintenance

When a real convention changes in code, update the matching guide in the same task (or immediately after). Prefer real paths (`apps/server/src/room-service.ts`) over inventing modules.

**Language**: documentation in **English**.
