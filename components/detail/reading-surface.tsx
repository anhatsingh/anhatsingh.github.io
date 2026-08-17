"use client";

import { ReaderControls, readerStyle, useReaderPrefs } from "./reader";

/*
  Wraps the body of a long page in the reader's own preferences.

  A client boundary as thin as it can be: it holds the preference state and the
  control, and everything inside stays a server component. The body renders on
  the server as it always did — the settings arrive as CSS custom properties on
  this wrapper, so the article responds without a single block knowing they
  exist.
*/
export function ReadingSurface({ children }: { children: React.ReactNode }) {
  const [prefs, update] = useReaderPrefs();

  return (
    <>
      <div className="reading" style={readerStyle(prefs)}>
        {children}
      </div>
      <ReaderControls prefs={prefs} update={update} />
    </>
  );
}
