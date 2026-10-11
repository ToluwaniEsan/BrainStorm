import Link from "next/link";

// Top menu shared by the signed-in pages. Styling is left plain on purpose:
// the visual design (globals.css) belongs to the design work.
const items = [
  { href: "/", label: "Home" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ current }: { current: "/" | "/profile" | "/settings" }) {
  return (
    <nav className="flex w-full max-w-6xl items-center justify-between gap-4">
      <Link href="/" className="text-xl font-semibold">
        Clutter
      </Link>
      <ul className="flex items-center gap-5 text-sm">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={current === i.href ? "page" : undefined} className={current === i.href ? "font-semibold underline" : "hover:underline"}>
              {i.label}
            </Link>
          </li>
        ))}
        <li>
          <a href="/auth/logout" className="hover:underline">
            Log out
          </a>
        </li>
      </ul>
    </nav>
  );
}
