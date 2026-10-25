# Activity compatibility

Verified 2026-10-25 with Desktop 26.1021.31345.

## Cause and fix

The bell was absent even with the sidebar open at desktop width. The extracted
Desktop still contained the complete Activity implementation; CSS had not removed
it. Its UI rollout gate `4039078146` was not retained by the browser adapter.
The original adapter only retained two other compatibility gates. Browser and
Desktop do not share the same renderer rollout evaluation/cache.

This gate has two consumers: the bell's visibility and the selection of the
contextual sidebar. `src/browser/feature-gates.ts` now retains it through the
existing `webview-statsig-override-adapter.patch` in both platform series. This
restores both consumers, without copying the Activity UI or sorting its DOM.
Desktop's account access checks still run; `denied` remains denied. Unrelated
gate evaluations are not changed.

## Preserved Desktop behavior

- Priority collects unread, active and waiting chats. Its display is optional.
- The chronological section sorts by descending recency and groups by Today,
  Yesterday and weekday, with a seven-day window in this Desktop version.
- Recency uses the underlying chat activity; the original logic also consults
  `thread-user-activity-times-v1` for user interaction with scheduled local chats.
  Simply visiting an old chat is not guaranteed to bump it to the top.
- Priority entries are not duplicated in the chronological section. The native
  reactive subscriptions continue updating the list while it is open.
- The options retain Priority, Pinned and Scheduled filters and native read/archive
  actions. Filter preferences persist; the Activity view itself can reopen closed
  after a page reload, as a view state rather than a saved filter preference.

Evidence in the clean bundles: primary functions `DDt`/`ODt` control availability,
`c6n`/`l6n` render the bell, `u6n` renders options, `tOt` groups/sorts recents,
`MDt` records interaction times, and `JDt` watches live changes. Initial-bundle
function `Dai` uses the same gate to choose the contextual sidebar. These names
are version-specific and must be reviewed on upgrade.

## Validation

- Before/after browser check: no Activity control before the adapter change;
  the original bell, Priority/Today/Yesterday sections and options appear afterward.
- Turning Priority off survives a reload. The original enabled preference was
  restored after testing. Read/archive bulk actions were not invoked.
- Mobile widths 320 and 390: bell and options have 44x44 targets, remain inside
  the drawer and cause no horizontal page overflow. Desktop width 1280 verified.
- Activating an existing chat from Activity by keyboard opens that chat and closes
  the mobile drawer. No message was sent during these checks. These are browser
  viewport checks, not a test on a physical phone.
- Five regression checks pass against each platform's freshly patched sources:
  rollout fallback, unrelated gates, retained account denial, newest-first/day
  grouping and Priority deduplication. These execute the extracted Desktop
  functions rather than a duplicate implementation.
- Both 20-patch series replay on clean formatted bundles with zero fuzz and zero
  line offsets. Patched Windows files match the live installation byte for byte.
  The prompt-search patch headers were regenerated after the earlier editor patch
  shifted their context by 12 lines. macOS runtime was not launched here.

See [UPGRADING.md](../UPGRADING.md) for repeatable checks. Desktop extracted sources
and screenshots of local chats stay out of Git.

## Live status before opening a chat (2026-10-25)

The browser's independent app-server returned `notLoaded` from `thread/list` for
chats actively running in native Desktop, with or without `useStateDbOnly`.
`thread/loaded/list` only covered that app-server's own loaded chats. Neither is
an authoritative list of active chats across Desktop windows/processes.

`webview-thread-activity.patch` connects local/remote-host `recentThreads` and
`listState` subscriptions to the existing `retainActiveConversation` mechanism.
It requests an owner snapshot over client coordination and then follows native
revisioned stream patches. It does not resume chats, start turns, mark them read,
or infer activity from timestamps. Cloud-host subscriptions retain their native
behavior. List changes and subscription disposal release follower interests;
native refcounts preserve interests held by an open chat or another subscriber.
This uses the existing owner stream, including its snapshot payload, rather than
introducing a new public HTTP API or repeatedly polling all archived history.

The adapter deliberately retains Desktop's `Yw.subscribe` RPC callback ownership
before wrapping the listener. Replacing that callback with an ordinary closure
first loses its remote lifetime after the subscription call returns. A regression
test executes the extracted subscription adapter and verifies delivery after the
original RPC argument has been released, plus cleanup of the retained copy.

Catalog-only rows previously short-circuited attention to unread/idle unless the
chat was selected. They now consume the live list state and the native pending
request calculation. Activity also recalculates status when the last-message
timestamp is unchanged. Waiting, unread holds, grouping and recency retain their
existing priority. The changes are conditional on the browser bridge.

Validation: a fresh LAN HTTP home page, without entering any chat, showed two
native Desktop chats as **Working** in Activity/Priority. Their preview continued
updating while the list stayed open. No message, resume or read action was used
for the check. Waiting/idle transitions and unchanged-recency updates are covered
by executable regression tests; no approval was created in a real user chat.
All 26 Activity, thread-status, mobile, HTTP compatibility and audio tests passed
against both clean replays. Each platform applied 23 patches with zero fuzz and
offsets; Windows replay matched the running sources. macOS runtime and a physical
phone were not tested in this change.
