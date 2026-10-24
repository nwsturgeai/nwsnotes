import { ApiError } from "./api";

interface Props {
  error: unknown;
  when: Date;
  onRetry: () => void;
}

/** Full-page error shown when the website can't start (e.g. the API is unavailable). */
export function ErrorPage({ error, when, onRetry }: Props) {
  const details: [string, string][] = [];
  const message = error instanceof Error ? error.message : String(error);

  details.push(["Time", `${when.toLocaleString()} (${when.toISOString()})`]);
  details.push(["Page", window.location.href]);
  if (error instanceof ApiError) {
    details.push(["Request", `${error.method} ${error.url}`]);
    details.push([
      "HTTP status",
      error.status === undefined ? "No response (server unreachable)" : `${error.status} ${error.statusText ?? ""}`.trim(),
    ]);
    if (error.responseBody) details.push(["Response body", error.responseBody]);
    if (error.underlying instanceof Error) details.push(["Underlying error", String(error.underlying)]);
  }
  if (error instanceof Error) {
    details.push(["Error type", error.name]);
    if (error.stack) details.push(["Stack trace", error.stack]);
  }
  details.push(["Browser", navigator.userAgent]);

  return (
    <main className="error-page">
      <h1>Something went wrong</h1>
      <p className="error-message">{message}</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
      <h2>Details</h2>
      <dl>
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <pre>{value}</pre>
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
