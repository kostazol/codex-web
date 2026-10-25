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
