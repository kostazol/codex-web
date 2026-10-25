/** Browser-only viewport and drawer behavior; desktop React state stays authoritative. */
export function installMobileUI(closeSidebar: () => void): void {
  const media = matchMedia("(max-width: 768px)");
  const viewport = window.visualViewport;
  const updateViewport = () => {
    // Do not fight accessibility pinch zoom by resizing the application underneath it.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    document.documentElement.style.setProperty(
      "--codex-web-viewport-height",
      `${viewport?.height ?? window.innerHeight}px`,
    );
    document.documentElement.style.setProperty(
      "--codex-web-viewport-top",
      `${viewport?.offsetTop ?? 0}px`,
    );
  };
  updateViewport();
  viewport?.addEventListener("resize", updateViewport);
  viewport?.addEventListener("scroll", updateViewport);
  window.addEventListener("resize", updateViewport);
  media.addEventListener("change", () => {
    if (media.matches) closeSidebar();
    updateViewport();
  });

  const initialize = () => {
    const backdrop = document.createElement("button");
    backdrop.id = "codex-web-drawer-backdrop";
    backdrop.setAttribute("aria-label", "Close navigation");
    backdrop.tabIndex = -1;
    const close = () => {
      closeSidebar();
      document
        .querySelector<HTMLButtonElement>("[data-app-shell-sidebar-trigger]")
        ?.focus();
    };
    backdrop.addEventListener("click", close);
    document.body.append(backdrop);
    // Main content cannot take accidental taps or keyboard focus behind the drawer.
    const syncDrawer = () => {
      const frame = document.querySelector<HTMLElement>(
        "[data-app-shell-frame]",
      );
      if (frame && backdrop.parentElement !== frame) frame.append(backdrop);
      const open =
        media.matches && frame?.dataset.appShellSidebarOpen === "true";
      for (const page of document.querySelectorAll<HTMLElement>(
        "[data-app-shell-active-page]",
      )) {
        if (open) {
          if (!page.inert) {
            page.inert = true;
            page.dataset.webDrawerInert = "true";
          }
        } else if (page.dataset.webDrawerInert) {
          page.inert = false;
          delete page.dataset.webDrawerInert;
        }
      }
    };
    const observer = new MutationObserver(syncDrawer);
    observer.observe(document.getElementById("root")!, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-app-shell-sidebar-open"],
    });
    media.addEventListener("change", syncDrawer);
    syncDrawer();
    // Android Remote uses bottom sheets for secondary composer controls. Keep
    // Desktop's menus (focus, dismissal, permissions and actions) authoritative;
    // only tag their portal wrappers for the phone layout.
    const syncSheets = () => {
      for (const menu of document.querySelectorAll<HTMLElement>(
        '[role="menu"][aria-labelledby]',
      )) {
        const trigger = document.getElementById(
          menu.getAttribute("aria-labelledby")!,
        );
        const wrapper = menu.parentElement;
        if (!wrapper?.hasAttribute("data-radix-popper-content-wrapper"))
          continue;
        const sheet =
          media.matches &&
          !!trigger?.closest(
            '[data-composer-body], [data-codex-web-sheet="true"]',
          );
        if (sheet) {
          menu.dataset.codexWebSheet = "true";
          wrapper.dataset.codexWebSheetWrapper = "true";
        } else {
          delete menu.dataset.codexWebSheet;
          delete wrapper.dataset.codexWebSheetWrapper;
        }
      }
    };
    const sheetObserver = new MutationObserver(syncSheets);
    sheetObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-labelledby", "data-state"],
    });
    media.addEventListener("change", syncSheets);
    syncSheets();
    // Radix opens on pointerdown. A bottom sheet can cover that same pointer
    // before pointerup, so consume the remainder of the opening gesture instead
    // of accidentally selecting a menu item (especially a permission preset).
    let openingPointer: number | null = null;
    let suppressOpeningClick = false;
    const inSheet = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest('[data-codex-web-sheet="true"]');
    document.addEventListener(
      "pointerdown",
      (event) => {
        suppressOpeningClick = false;
        const trigger =
          event.target instanceof Element
            ? event.target.closest('[aria-haspopup="menu"]')
            : null;
        openingPointer =
          media.matches &&
          trigger?.closest(
            '[data-composer-body], [data-codex-web-sheet="true"]',
          )
            ? event.pointerId
            : null;
      },
      true,
    );
    document.addEventListener(
      "pointerup",
      (event) => {
        if (openingPointer !== event.pointerId) return;
        openingPointer = null;
        if (inSheet(event.target)) {
          suppressOpeningClick = true;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        if (suppressOpeningClick && inSheet(event.target)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        suppressOpeningClick = false;
      },
      true,
    );
    document.addEventListener(
      "pointercancel",
      () => {
        openingPointer = null;
        suppressOpeningClick = false;
      },
      true,
    );
    document.addEventListener("keydown", (event) => {
      if (!media.matches) return;
      if (
        event.key === "Escape" &&
        document.querySelector('[data-app-shell-sidebar-open="true"]')
      ) {
        close();
      }
    });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
}
