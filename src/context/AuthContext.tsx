import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AuthUser } from "../lib/api";

type Status = "loading" | "authed" | "guest";

type AuthContextValue = {
  user: AuthUser | null;
  status: Status;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
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

  return <AuthContext.Provider value={{ user, status, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
