import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute() {
  const { status } = useAuth();

  if (status === "loading") return null;
  if (status === "guest") return <Navigate to="/login" replace />;

  return <Outlet />;
}
