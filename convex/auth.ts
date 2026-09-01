import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";

// Anonymous is the primary path: a judge opens the live URL and can use the app
// immediately, with no login wall. Password lets a real user come back later.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous, Password()],
});
