import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { config as fontAwesomeConfig } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
// The app's font, shipped with it: every weight, upright only (italic is the upright letters slanted).
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import { App } from "./App";
import { initAppUpdates } from "./appUpdate";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import { SIGN_UP_PATH, SignUpPage } from "./SignUpPage";
import "./styles.css";

// Font Awesome's styles are bundled (imported above) rather than added to the page at run time.
fontAwesomeConfig.autoAddCss = false;

initAppUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RenderErrorBoundary>
      {/* The sign-up page is public and stands alone: it needs no login, notes or offline copy. */}
      {window.location.pathname === SIGN_UP_PATH ? <SignUpPage /> : <App />}
    </RenderErrorBoundary>
  </StrictMode>,
);
