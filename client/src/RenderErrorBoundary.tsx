import { Component, type ErrorInfo, type ReactNode } from "react";

/** What went wrong, kept so it can be shown (and, later, sent to the admin). */
export interface RenderErrorReport {
  message: string;
  errorType?: string;
  stack?: string;
  componentStack?: string;
  page: string;
  when: Date;
  browser: string;
}

interface State {
  report?: RenderErrorReport;
}

/**
 * Catches any error while showing the app (rather than React leaving a blank page) and shows a
 * "nwsnotes hit a problem" page in its place, with the details for reporting it.
 */
export class RenderErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: unknown): State {
    return {
      report: {
        message: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
        page: window.location.href,
        when: new Date(),
        browser: navigator.userAgent,
      },
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("nwsnotes hit a problem:", error, info.componentStack);
    this.setState((prev) =>
      prev.report ? { report: { ...prev.report, componentStack: info.componentStack ?? undefined } } : prev,
    );
  }

  render() {
    const { report } = this.state;
    return report ? <RenderErrorPage report={report} /> : this.props.children;
  }
}

function RenderErrorPage({ report }: { report: RenderErrorReport }) {
  const details: [string, string | undefined][] = [
    ["Time", `${report.when.toLocaleString()} (${report.when.toISOString()})`],
    ["Page", report.page],
    ["Error", report.message],
    ["Error type", report.errorType],
    ["Stack trace", report.stack],
    ["Component stack", report.componentStack?.trim()],
    ["Browser", report.browser],
  ];

  return (
    <main className="error-page">
      <h1>nwsnotes hit a problem</h1>
      <p className="error-message">Something went wrong while showing this page. Reloading usually fixes it.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
      <details className="error-details">
        <summary>Details</summary>
        <dl>
          {details
            .filter((entry): entry is [string, string] => !!entry[1])
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <pre>{value}</pre>
                </dd>
              </div>
            ))}
        </dl>
      </details>
    </main>
  );
}
