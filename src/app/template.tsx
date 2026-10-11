import { ViewTransition } from "react";

// Remounts on every navigation. The ViewTransition crossfades the old page
// out and eases the new one in (styles in clutter.css), while the bar and the
// bubbles stay live underneath.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="c-page-in" exit="c-page-out" default="none">
      <div className="flex flex-1 flex-col">{children}</div>
    </ViewTransition>
  );
}
