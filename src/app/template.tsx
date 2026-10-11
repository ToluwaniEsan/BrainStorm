// Remounts on every navigation, so each page eases in under the floating bar.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="c-enter flex flex-1 flex-col">{children}</div>;
}
