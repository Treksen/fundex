import React from "react";
import ReactDOM from "react-dom/client";
import toast from "react-hot-toast";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { errorReporter } from "./lib/supabase";
import { installErrorCapture } from "./lib/errorCapture";

// Error Log: every error message shown to a user, and any uncaught error, is recorded (see errorCapture.js).
installErrorCapture({ toast, win: window, report: errorReporter.report, getPage: () => window.location.pathname });
window.addEventListener("online", () => errorReporter.flush());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") errorReporter.flush(); });

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
