# Frontend Development Guidelines

> Authoritative conventions for `apps/web` and its use of `@huanghuang/protocol`.

---

## Overview

Document **what this repo actually does**. The web app is a projection renderer: authority stays on the server; pure modules may only derive presentation and highlight state from projection fields.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | `apps/web` layout and ownership | Active |
| [Component Guidelines](./component-guidelines.md) | Components, themes, action dock, motion | Active |
| [Hook Guidelines](./hook-guidelines.md) | `useRoom` Socket lifecycle and mutations | Active |
| [State Management](./state-management.md) | Projection versioning, local vs server state | Active |
| [Quality Guidelines](./quality-guidelines.md) | Checks, tests, a11y, forbidden client rules | Active |
| [Type Safety](./type-safety.md) | Protocol ownership and TS strictness | Active |
| [Mini-Program](./miniprogram.md) | Taro/WeChat WXSS compatibility, automation testing recipe | Active |

## Pre-Development Checklist

When changing web UI or client networking, read at least:

1. [Directory Structure](./directory-structure.md) — where the change belongs
2. [Hook Guidelines](./hook-guidelines.md) — if Socket, commands, or room restore change
3. [State Management](./state-management.md) — if projection or local state ownership changes
4. [Component Guidelines](./component-guidelines.md) — if table, tiles, or action chrome change
5. [Type Safety](./type-safety.md) — if shared types or payloads change
6. Shared [Thinking Guides](../guides/index.md) when the change crosses layers

## Maintenance

When UI conventions change (new pure helper module, theme tokens, action mapping), update the matching guide in the same task. Prefer citing real files under `apps/web/src`.

**Language**: documentation in **English**.
