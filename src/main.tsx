import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Suppress unhandled promise rejections & uncaught script errors originating from third-party browser extensions (e.g. 200.js / M_ID injections)
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (
    reason?.stack?.includes('200.js') ||
    reason?.message?.includes('M_ID') ||
    (typeof reason === 'string' && reason.includes('M_ID'))
  ) {
    event.preventDefault();
    console.warn('[Extension Guard] Ignored third-party browser extension unhandled rejection:', reason?.message || reason);
  }
});

window.addEventListener('error', (event) => {
  if (
    event.filename?.includes('200.js') ||
    event.error?.message?.includes('M_ID') ||
    event.message?.includes('M_ID')
  ) {
    event.preventDefault();
    console.warn('[Extension Guard] Ignored third-party script error:', event.message);
  }
});

createRoot(document.getElementById("root")!).render(<App />);

// Register service worker for PWA offline support (production only).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
