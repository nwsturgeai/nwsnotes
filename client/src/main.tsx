import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { config as fontAwesomeConfig } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
// The app's font, shipped with it: every weight, upright only (italic is the upright letters slanted).
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import { App } from "./App";
import { initAppUpdates } from "./appUpdate";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import { CONFIRM_EMAIL_PATH, FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH, SHARE_INVITE_PATH } from "@nwsnotes/shared";
import { ConfirmEmailPage } from "./ConfirmEmailPage";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { ShareInvitePage } from "./ShareInvitePage";
import { SIGN_UP_PATH, SignUpPage } from "./SignUpPage";
import "./styles.css";

// Font Awesome's styles are bundled (imported above) rather than added to the page at run time.
fontAwesomeConfig.autoAddCss = false;

initAppUpdates();

/** The public pages that stand alone: they need no login, notes or offline copy. */
function PublicOrApp() {
  switch (window.location.pathname) {
    case SIGN_UP_PATH:
      return <SignUpPage />;
    case FORGOT_PASSWORD_PATH:
      return <ForgotPasswordPage />;
    case RESET_PASSWORD_PATH:
      return <ResetPasswordPage />;
    case CONFIRM_EMAIL_PATH:
      return <ConfirmEmailPage />;
    case SHARE_INVITE_PATH:
      return <ShareInvitePage />;
    default:
      return <App />;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RenderErrorBoundary>
      <PublicOrApp />
    </RenderErrorBoundary>
  </StrictMode>,
);
