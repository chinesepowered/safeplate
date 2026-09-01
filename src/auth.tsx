import { type ReactNode, useEffect } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";

/**
 * Judges must never hit a login wall: opening the live URL signs you in
 * anonymously and drops you straight into the app. Password sign-in exists so a
 * real user can come back to their data later.
 */
export function EnsureSignedIn({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      void signIn("anonymous");
    }
  }, [isLoading, isAuthenticated, signIn]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen grid place-items-center bg-stone-50">
        <div className="flex items-center gap-3 text-stone-500">
          <span className="size-4 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
          Starting up
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
