import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import type { AuthUser } from "../lib/api";
import { canModule, moduleOfPath } from "../lib/access";

const ESTATE_HOME: Record<string, string> = {
  NILAM: "/inventory",
  KNS: "/inventory-kns",
  WJA: "/inventory-wja",
  ZAMRUD: "/inventory-zamrud",
  FIRUS: "/inventory-firus",
};

// Everyone lands on the dashboard ("/"), which is scoped to their estate. An estate account with
// no valid estate has nowhere to go, so it's sent back to /login (which offers "Keluar").
export function homeRouteFor(user: AuthUser | null): string {
  if (!user) return "/login";
  if (user.role === "superuser") return "/";
  return ESTATE_HOME[user.estate ?? ""] ? "/" : "/login";
}

// Mirrors the server's requireEstate()/requireSuperuser() in app.ts - this is convenience
// routing (redirect to where the user actually belongs), not the security boundary itself.
// An account limited to some modules (e.g. admin Klinik) is also kept out of the other modules' pages.
export function RequireEstate({ estate, children }: { estate: string; children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  const m = moduleOfPath(pathname);
  if ((user.role === "superuser" || user.estate === estate) && (!m || canModule(user, m))) return <>{children}</>;
  return <Navigate to={homeRouteFor(user)} replace />;
}

export function RequireSuperuser({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "superuser") return <>{children}</>;
  return <Navigate to={homeRouteFor(user)} replace />;
}
