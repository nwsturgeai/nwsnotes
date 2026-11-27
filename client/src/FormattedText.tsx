import { Fragment, type ReactNode } from "react";
import { formatLine, tickboxOf, type FormattedRun } from "@nwsnotes/shared";

/**
 * Text with its *bold*, _underline_, /italic/, -strikethrough- and #highlight# markers applied (see
 * formatLine). The markers are hidden, or with `showMarkers` kept (dimmed), so the text matches what was
 * typed character for character (the long-form text box's display layer relies on that). With
 * `tickboxes` (long-form details only), a "[ ]" or "[x]" starting a line is drawn as a tickbox over its
 * characters, and the rest of a ticked line is struck through.
 */
export function FormattedText({ text, showMarkers = false, tickboxes = false }: { text: string; showMarkers?: boolean; tickboxes?: boolean }) {
  const runs = (line: string) =>
    formatLine(line).map((run, runIndex) =>
      run.marker && !showMarkers ? null : (
        <span key={runIndex} className={runClass(run)}>
          {run.text}
        </span>
      ),
    );
  return (
    <>
      {text.split("\n").map((line, index) => {
        const tickbox = tickboxes ? tickboxOf(line) : undefined;
        const rest = tickbox ? line.slice(tickbox.indent.length + tickbox.box.length) : line;
        // On a ticked line, the struck-through text starts after the space following the tickbox.
        const gap = tickbox?.ticked ? /^[ \t]*/.exec(rest)![0] : "";
        return (
          <Fragment key={index}>
            {index > 0 && "\n"}
            {tickbox && (
              <>
                {tickbox.indent}
                <span className={tickbox.ticked ? "fmt-tickbox ticked" : "fmt-tickbox"}>{tickbox.box}</span>
              </>
            )}
            {tickbox?.ticked ? (
              <>
                {gap}
                <span className="fmt-ticked">{runs(rest.slice(gap.length))}</span>
              </>
            ) : (
              runs(rest)
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function runClass(run: FormattedRun): string | undefined {
  const classes = [...run.styles.map((style) => `fmt-${style}`), run.marker && "fmt-marker"].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

/**
 * The long-form text box's tickboxes as things to click, for a layer above the text box: the text is
 * plain and invisible (plain letters are the same widths as the formatted ones), so each tickbox lands
 * exactly over the one drawn underneath. Only the tickboxes take clicks; everything else reaches the text box.
 */
export function TickboxTargets({ text, onToggle }: { text: string; onToggle: (lineIndex: number) => void }) {
  return (
    <>
      {text.split("\n").map((line, index): ReactNode => {
        const tickbox = tickboxOf(line);
        return (
          <Fragment key={index}>
            {index > 0 && "\n"}
            {tickbox ? (
              <>
                {tickbox.indent}
                <span
                  className="fmt-tickbox-target"
                  title={tickbox.ticked ? "Untick" : "Tick"}
                  // Keep the text box focused (or not), so a tap on a phone doesn't bring up the keyboard.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onToggle(index)}
                >
                  {tickbox.box}
                </span>
                {line.slice(tickbox.indent.length + tickbox.box.length)}
              </>
            ) : (
              line
            )}
          </Fragment>
        );
      })}
    </>
  );
}
