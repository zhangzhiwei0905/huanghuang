# Frontend State Management

## State categories

| Category | Owner | Examples |
|---|---|---|
| Authoritative room state | Typed external store fed by server projections | hand, scores, legal actions, deadline |
| Local UI state | React component state | selected tile, open dialog |
| URL state | Router/search params | invitation room code |
| Preference state | localStorage | theme, mute |

## Contract

The server projection replaces authoritative state by monotonically increasing `version`. Components derive display values from that projection.

```ts
if (update.version === current.version + 1) {
  store.replace(update.projection);
} else if (update.version > current.version + 1) {
  requestFullSnapshot();
}
```

## Wrong vs correct

Wrong: remove a tile immediately after the user clicks discard.

Correct: disable duplicate submission, wait for the command acknowledgement and render the next server projection.

## Tests required

- Older projections never overwrite newer state.
- Missing versions trigger snapshot recovery.
- Theme changes do not reset room state or Socket subscriptions.
