import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import type { AuthUser } from "../lib/api";
import { canModule, hasDashboard, landingPath, moduleOfPath, pageAllowed, userEstates } from "../lib/access";

// An account with an inventory module lands on the dashboard ("/"); one without lands on the first
// page it can open (landingPath, e.g. Koperasi). An account with no estate and no page permission has nowhere to go, so it's sent back to /login (which
// offers "Keluar").
export function homeRouteFor(user: AuthUser | null): string {
  if (!user) return "/login";
  if (user.role === "superuser" || userEstates(user).length || (user.perms ?? []).length) return landingPath(user);
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

// The main Dashboard ("/"): an account without any inventory module goes to its landing page instead.
export function HomeGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!hasDashboard(user)) return <Navigate to={landingPath(user)} replace />;
  return <>{children}</>;
}

// Master data / monitoring / Stok Opname pages (pageAllowed), superuser for anything else.
export function RequirePageAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  if (pageAllowed(user, pathname)) return <>{children}</>;
  return <Navigate to={homeRouteFor(user)} replace />;
}
