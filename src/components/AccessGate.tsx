import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import type { AuthUser } from "../lib/api";
import { can, canModule, moduleOfPath, PAGE_PERMS, userEstates } from "../lib/access";

// Everyone lands on the dashboard ("/"), which shows only what the account may open. An account
// with no estate and no page permission has nowhere to go, so it's sent back to /login (which
// offers "Keluar").
export function homeRouteFor(user: AuthUser | null): string {
  if (!user) return "/login";
  if (user.role === "superuser" || userEstates(user).length || (user.perms ?? []).length) return "/";
  return "/login";
}

// Mirrors the server's estate + permission checks in app.ts - this is convenience routing
// (redirect to where the user actually belongs), not the security boundary itself.
export function RequireEstate({ estate, children }: { estate: string; children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  const m = moduleOfPath(pathname);
  if (userEstates(user).includes(estate) && (!m || canModule(user, m))) return <>{children}</>;
  return <Navigate to={homeRouteFor(user)} replace />;
}

// Master data / monitoring pages: the page's permission (PAGE_PERMS), superuser for anything else.
export function RequirePageAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  const perm = PAGE_PERMS[pathname];
  if (user.role === "superuser" || (perm && can(user, perm))) return <>{children}</>;
  return <Navigate to={homeRouteFor(user)} replace />;
}
