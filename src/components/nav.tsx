"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

// The floating bar at the top of every page. It lives in the root layout, so
// it stays put while pages change underneath it; the pill slides to the
// current page.
const items = [
  { href: "/", label: "Home" },
  { href: "/studio", label: "Studio" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const path = usePathname();
  const here = items.find((i) => (i.href === "/" ? path === "/" : path.startsWith(i.href)))?.href;
  // The pill starts moving the moment a tab is tapped, not when the new page
  // arrives from the server, so the bar never feels stuck.
  const [tapped, setTapped] = useState<{ from: string; to: string } | null>(null);
  const current = tapped && tapped.from === path ? tapped.to : here;
  const refs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = current ? refs.current[current] : null;
      setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    place();
    window.addEventListener("resize", place);
    void document.fonts?.ready.then(place);
    return () => window.removeEventListener("resize", place);
  }, [current]);

  return (
    <nav className="c-bar" aria-label="Main">
      <span
        className="c-bar-pill"
        aria-hidden="true"
        style={pill ? { transform: `translateX(${pill.left}px)`, width: pill.width } : { opacity: 0 }}
      />
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          ref={(el) => {
            refs.current[i.href] = el;
          }}
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) setTapped({ from: path, to: i.href });
          }}
          aria-current={here === i.href ? "page" : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
