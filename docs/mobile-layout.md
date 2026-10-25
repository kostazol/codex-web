# Mobile interaction contract

Updated 2026-10-25 for Desktop 26.1021.31345 following the Samsung S20 report.

The earlier adaptation retained too much Desktop behavior: its navigation CSS
covered only the application-menu variant; pinned and hover/peek sidebar state
were different; chat hover previews could consume a click; and opening a tool
kept a desktop split with almost no room for the conversation.

## Phone and tablet behavior

- Up to 1024 CSS pixels, use one explicit navigation button. It opens Chats and
  becomes a close button in the same place. The phone drawer uses the full width;
  on a wider tablet it is capped at 440px. Closing never requires finding a narrow
  strip outside the drawer. The native store remains authoritative; both hover
  and peek state are cleared when opening or closing.
- Native navigation variants are tagged by the platform patch and hidden in this
  layout. Activity and its original recency/filter implementation are retained.
  Selecting a chat opens it directly and closes the drawer, without a hover preview.
- The drawer makes the conversation and its header inert. Keyboard focus wraps
  inside navigation. Escape closes the current menu/dialog before the drawer.
- Secondary menus use bottom sheets with a visible 48px Close button. Native
  selection, permissions, confirmations and focus restoration are unchanged.
  The gesture that opens a sheet cannot select an option underneath the pointer.
- Tool/file/browser tabs use a full-width screen with a visible arrow and Chat
  return action. There is no phone split-pane resizer. Hidden chat controls cannot
  receive focus behind the tool screen.
- Header and composer controls have at least 44px touch targets. Native header
  space reserved for the tab controls must stay intact to avoid overlapping buttons.
- Visual viewport height and safe-area insets constrain drawers, sheets and the
  composer. Landscape phones remain in the mobile layout. Pinch zoom is not disabled.
- Navigation, sheets and tool screens composite their theme color over a solid
  light/dark base. Desktop's `--color-token-bg-primary` / surface-under is not an
  opaque-color contract. While Chats is open, the active page is also hidden from
  painting, not merely made inert; closing restores its visibility and state.
- Above 1024px, Desktop navigation, hover behavior, anchored menus and pane layouts
  remain native. No account permissions or model selection are changed by resizing.

## Patch and asset lifecycle

Both `webview-mobile.patch` variants target stable hooks and the pinned native
store/hover handlers. `src/browser/mobile.ts` owns the browser interaction layer.
It imports `assets/mobile.css?inline`, so rebuilding the preload ships matching
styles and behavior together instead of relying on a separately cached stylesheet.
Rebuild the browser bridge after applying the platform patch series.

Keep the two platform variants in sync. Use `scripts/verify-patches.mjs` on clean
formatted bundles, and run `tests/mobile.test.cjs` and `tests/activity.test.cjs`
with `CODEX_WEB_ASAR_DIR` pointing at each result. The native function names are
version-specific and require review on Desktop upgrades.

## Acceptance checks

Use existing test chats without sending messages or changing their drafts:

1. At 320x720, 360x800, 412x915, 800x360 and 1024x768, inspect header and composer
   bounds and hit targets. Check actual overlaps, not just document scroll width.
2. Open/close Chats repeatedly using the same button. Open Activity, enter a chat
   with one click, and confirm the drawer closes. Confirm Activity filters remain.
3. Open model, permission, chat-action and Activity menus. Close explicitly; check
   nested menus, scrolling, and Escape. Do not change permission presets to test UI.
4. Open a blank tool tab, inspect its full-width bounds, return with Chat, and check
   the original draft is still present. Close only the disposable tab created by QA.
5. Repeat sheet checks in a reduced-height viewport to model keyboard obstruction.
6. At 1280x900, verify native navigation and anchored menus, with no phone controls.

Browser viewport checks are not physical-device verification. Android/iOS keyboard,
browser chrome, Back gestures and installed-PWA behavior need a real-device pass.
The app still requires a running connected host; this change adds no offline chat
cache or service worker.

## Recorded verification

- Header/composer geometry at 320x720, 360x800, 412x915, 800x360 and 1024x768:
  no off-screen controls, no overlaps, no targets below 44px, no page overflow.
- At 360x430, permission, model and chat-action sheets stay inside the viewport;
  their Close buttons dismiss without changing the selection. Activity's menu
  dismisses before the drawer on Escape.
- Existing chats open from Activity with one click. Draft text survives reload
  and the return from a tool tab. No messages were submitted during QA.
- Tool tabs occupy the full 320px screen; native desktop split view had left only
  a 36px conversation strip in the earlier implementation.
- At 1280x900, the phone control is hidden and native anchored menus have no
  mobile sheet markers or injected Close button.
- Both full 20-patch series apply with zero fuzz/offset. The Windows result matches
  the running patched source files. All eight Activity/mobile regression tests
  pass on each platform tree. Browser build and mobile TypeScript check pass.
- macOS and physical Android/iOS runtimes were not launched for this verification.
- Opacity regression: a controlled page using the real mobile CSS, a transparent
  Desktop surface-under token and a 25%-opaque theme base reproduced overlapping
  chat/menu text with the old styles. The corrected styles provide an opaque
  `rgb(24, 24, 24)` / `rgb(255, 255, 255)` base in dark/light modes and hide the
  underlying page only while navigation is open.
  In the real chat, closing navigation restores page visibility and preserves
  the existing composer draft byte for byte.
