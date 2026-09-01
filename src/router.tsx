import { useEffect, useState } from "react";

/**
 * A twenty-line router. The app has four screens and the static-hosting
 * component already falls back to index.html, so pulling in a routing library
 * would be more configuration than code.
 */
export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    window.addEventListener("sp:navigate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("sp:navigate", onPop);
    };
  }, []);
  return path;
}

export function navigate(to: string) {
  if (window.location.pathname === to) return;
  window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("sp:navigate"));
  window.scrollTo(0, 0);
}

export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
