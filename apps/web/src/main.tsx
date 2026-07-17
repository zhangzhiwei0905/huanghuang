import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

function installViewportSync(): () => void {
  let frame: number | null = null;
  const viewport = window.visualViewport;
  const sync = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      const height = Math.round(viewport?.height ?? window.innerHeight);
      document.documentElement.style.setProperty("--app-height", `${height}px`);
      frame = null;
    });
  };

  sync();
  window.addEventListener("resize", sync);
  window.addEventListener("orientationchange", sync);
  window.addEventListener("pageshow", sync);
  viewport?.addEventListener("resize", sync);
  return () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", sync);
    window.removeEventListener("orientationchange", sync);
    window.removeEventListener("pageshow", sync);
    viewport?.removeEventListener("resize", sync);
  };
}

installViewportSync();

const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
document.documentElement.dataset.displayMode =
  window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true
    ? "standalone"
    : "browser";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) {
  throw new Error("Root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
