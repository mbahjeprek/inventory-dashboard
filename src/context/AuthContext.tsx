import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AuthUser } from "../lib/api";

type Status = "loading" | "authed" | "guest";

type AuthContextValue = {
  user: AuthUser | null;
  status: Status;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  // Re-reads the account (estates, permissions) so a change made in Pengguna shows without logging in again.
  refresh: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    api
      .me()
      .then(({ user }) => {
        setUser(user);
        setStatus("authed");
      })
      .catch(() => setStatus("guest"));
  }, []);

  // A permission ticked or unticked meanwhile applies on the next page change / when the tab is back
  // in view (MainLayout), so buttons the account may no longer use disappear. Kept when unchanged.
  const refresh = useCallback(() => {
    api
      .me()
      .then(({ user: fresh }) => setUser((cur) => (JSON.stringify(cur) === JSON.stringify(fresh) ? cur : fresh)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const { user } = await api.login(username, password);
    setUser(user);
    setStatus("authed");
    return user;
  };

  const logout = async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setStatus("guest");
  };

  return <AuthContext.Provider value={{ user, status, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
