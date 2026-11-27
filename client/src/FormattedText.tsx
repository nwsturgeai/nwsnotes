import { Fragment } from "react";
import { formatLine, type FormattedRun } from "@nwsnotes/shared";

/**
 * Text with its *bold*, _underline_, /italic/, -strikethrough- and #highlight# markers applied (see formatLine). The markers are
 * hidden, or with `showMarkers` kept (dimmed), so the text matches what was typed character for
 * character (the long-form text box's display layer relies on that).
 */
export function FormattedText({ text, showMarkers = false }: { text: string; showMarkers?: boolean }) {
  return (
    <>
      {text.split("\n").map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          {formatLine(line).map((run, runIndex) =>
            run.marker && !showMarkers ? null : (
              <span key={runIndex} className={runClass(run)}>
                {run.text}
              </span>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

function runClass(run: FormattedRun): string | undefined {
  const classes = [...run.styles.map((style) => `fmt-${style}`), run.marker && "fmt-marker"].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}
