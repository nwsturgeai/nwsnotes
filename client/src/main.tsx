import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { config as fontAwesomeConfig } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import { App } from "./App";
import { initAppUpdates } from "./appUpdate";
import "./styles.css";

// Font Awesome's styles are bundled (imported above) rather than added to the page at run time.
fontAwesomeConfig.autoAddCss = false;

initAppUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
