import mobileStyles from "../../assets/mobile.css?inline";
import composerStyles from "../../assets/mobile-composer.css?inline";
import { installMobileComposer } from "./mobile-composer";

/** Browser layout only. All chat state and actions remain in Desktop React. */
export function installMobileUI(setSidebarOpen: (open: boolean) => void): void {
  const media = matchMedia("(max-width: 1024px)");
  // Ship styles with the bridge: a stale standalone CSS response must not leave
  // a new mobile controller using an older desktop layout.
  const style = document.createElement("style");
  style.id = "codex-web-mobile-styles";
  style.textContent = mobileStyles + composerStyles;
  document.head.append(style);
  installMobileComposer();
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
    if (media.matches) setSidebarOpen(false);
    updateViewport();
  });

  const initialize = () => {
    const backdrop = document.createElement("button");
    backdrop.id = "codex-web-drawer-backdrop";
    backdrop.setAttribute("aria-label", "Close navigation");
    backdrop.tabIndex = -1;
    const toggle = document.createElement("button");
    toggle.id = "codex-web-navigation-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-controls", "app-shell-sidebar");
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path data-menu-icon d="M4 6h16M4 12h16M4 18h16"/><path data-close-icon d="m6 6 12 12M18 6 6 18"/></svg>';
    const isOpen = () =>
      media.matches &&
      document.querySelector(
        '[data-app-shell-frame][data-app-shell-sidebar-open="true"]',
      ) !== null;
    const close = () => {
      setSidebarOpen(false);
      toggle.focus({ preventScroll: true });
    };
    toggle.addEventListener("click", () => {
      setSidebarOpen(!isOpen());
    });
    backdrop.addEventListener("click", close);
    document.body.append(backdrop, toggle);
    // Main content cannot take accidental taps or keyboard focus behind the drawer.
    const syncDrawer = () => {
      const frame = document.querySelector<HTMLElement>(
        "[data-app-shell-frame]",
      );
      if (frame && backdrop.parentElement !== frame) frame.append(backdrop);
      if (frame && toggle.parentElement !== frame) frame.append(toggle);
      const open =
        media.matches && frame?.dataset.appShellSidebarOpen === "true";
      toggle.setAttribute("aria-expanded", String(!!open));
      toggle.setAttribute("aria-label", open ? "Close chats" : "Open chats");
      const panel = frame?.querySelector<HTMLElement>(".app-shell-left-panel");
      if (panel) {
        if (open) {
          // The close control lives in the persistent header, outside this
          // panel. A navigation landmark keeps it reachable to screen readers.
          panel.setAttribute("role", "navigation");
          panel.setAttribute("aria-label", "Chats");
          panel.dataset.codexWebDrawer = "true";
        } else if (panel.dataset.codexWebDrawer) {
          panel.removeAttribute("role");
          panel.removeAttribute("aria-modal");
          panel.removeAttribute("aria-label");
          delete panel.dataset.codexWebDrawer;
        }
      }
      const toolPanelOpen =
        media.matches &&
        !!frame?.querySelector(
          'aside[data-app-shell-focus-area="right-panel"]:not([aria-hidden="true"])',
        );
      if (frame) frame.dataset.codexWebToolPanel = String(toolPanelOpen);
      for (const page of document.querySelectorAll<HTMLElement>(
        "[data-app-shell-active-page], [data-app-shell-titlebar], [data-app-shell-main-titlebar]",
      )) {
        if (
          open ||
          (toolPanelOpen && page.matches("[data-app-shell-main-titlebar]"))
        ) {
          if (!page.inert) {
            page.inert = true;
            page.dataset.webDrawerInert = "true";
          }
        } else if (page.dataset.webDrawerInert) {
          page.inert = false;
          delete page.dataset.webDrawerInert;
        }
      }
      for (const content of document.querySelectorAll<HTMLElement>(
        "[data-app-shell-main-content-layout]",
      )) {
        if (toolPanelOpen && !content.inert) {
          content.inert = true;
          content.dataset.webPanelInert = "true";
        } else if (!toolPanelOpen && content.dataset.webPanelInert) {
          content.inert = false;
          delete content.dataset.webPanelInert;
        }
      }
    };
    const observer = new MutationObserver(syncDrawer);
    observer.observe(document.getElementById("root")!, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "data-app-shell-sidebar-open",
        "aria-hidden",
        "data-app-shell-workspace-layout",
      ],
    });
    media.addEventListener("change", syncDrawer);
    syncDrawer();
    // Android Remote uses bottom sheets for secondary controls. Keep
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
        const nested = !!trigger?.closest('[role="menu"]');
        const sheet = media.matches && !nested;
        if (sheet) {
          menu.dataset.codexWebSheet = "true";
          wrapper.dataset.codexWebSheetWrapper = "true";
          if (!wrapper.querySelector("[data-codex-web-sheet-close]")) {
            const closeMenu = document.createElement("button");
            closeMenu.type = "button";
            closeMenu.dataset.codexWebSheetClose = "true";
            closeMenu.textContent = "Close";
            closeMenu.setAttribute("aria-label", "Close menu");
            closeMenu.addEventListener("click", () => {
              menu.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  code: "Escape",
                  bubbles: true,
                  cancelable: true,
                }),
              );
            });
            menu.prepend(closeMenu);
          }
        } else {
          delete menu.dataset.codexWebSheet;
          delete wrapper.dataset.codexWebSheetWrapper;
          menu.querySelector("[data-codex-web-sheet-close]")?.remove();
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
        openingPointer = media.matches && trigger ? event.pointerId : null;
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
    document.addEventListener(
      "keydown",
      (event) => {
        if (!media.matches) return;
        // Let a menu/dialog dismiss first. Escape must not close two layers.
        if (
          document.querySelector(
            '[role="menu"], [role="dialog"]:not([data-codex-web-drawer]), [role="alertdialog"]',
          )
        )
          return;
        if (event.key === "Escape" && !event.defaultPrevented && isOpen()) {
          event.preventDefault();
          close();
        }
        if (event.key === "Tab" && isOpen()) {
          const panel = document.querySelector("[data-codex-web-drawer]");
          const targets = [
            toggle,
            ...(panel?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input, [tabindex="0"]',
            ) ?? []),
          ].filter(
            (node) =>
              node.getClientRects().length &&
              getComputedStyle(node).visibility !== "hidden" &&
              !node.closest("[inert]"),
          );
          const current = targets.indexOf(
            document.activeElement as HTMLElement,
          );
          if (
            (event.shiftKey && current <= 0) ||
            (!event.shiftKey && current === targets.length - 1)
          ) {
            event.preventDefault();
            targets[event.shiftKey ? targets.length - 1 : 0]?.focus();
          }
        }
      },
      true,
    );
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
}
