/** Layout ownership only: the native editor, controls and recording stay mounted. */
export function installMobileComposer(): void {
  const selector = '[data-codex-web-composer="adaptive"]';
  const expanded = new Set<HTMLElement>();
  let collapseTimer: ReturnType<typeof setTimeout> | undefined;

  const expandEditor = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const editor = target.closest('[contenteditable="true"]');
    const composer = editor?.closest<HTMLElement>(selector);
    if (!composer || !matchMedia("(max-width: 1024px)").matches) return;
    clearTimeout(collapseTimer);
    composer.dataset.codexWebExpanded = "true";
    expanded.add(composer);
  };
  const collapseOutside = (target: EventTarget | null) => {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      for (const composer of expanded) {
        const inside = target instanceof Node && composer.contains(target);
        const menuOpen = composer.querySelector(
          '[aria-expanded="true"], [data-state="open"]',
        );
        if (composer.isConnected && (inside || menuOpen)) continue;
        delete composer.dataset.codexWebExpanded;
        expanded.delete(composer);
      }
    }, 180);
  };
  document.addEventListener("focusin", (event) => {
    expandEditor(event.target);
    collapseOutside(event.target);
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      expandEditor(event.target);
      // Keep the layout stable while a tap moves focus from the editor to Send,
      // Dictate or a portal menu. Collapsing on :focus loss moves targets mid-tap.
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(
          '[role="menu"], [role="dialog"], [role="listbox"]',
        )
      ) {
        collapseOutside(event.target);
      }
    },
    true,
  );
  document.addEventListener("focusout", () =>
    collapseOutside(document.activeElement),
  );
}
