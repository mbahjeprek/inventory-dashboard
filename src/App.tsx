import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RequireEstate, RequirePageAccess } from "./components/AccessGate";
import { LoginPage } from "./pages/LoginPage";
import { MainLayout } from "./layouts/MainLayout";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryGudangStockPage } from "./pages/InventoryGudangStockPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { KaryawanPage } from "./pages/KaryawanPage";
import { InventoryBbmPage } from "./pages/InventoryBbmPage";
import { AlatBeratPage } from "./pages/AlatBeratPage";
import { MasterBarangPage } from "./pages/MasterBarangPage";
import { UsersPage } from "./pages/UsersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InventoryPupukPage } from "./pages/InventoryPupukPage";
import { InventoryKlinikPage } from "./pages/InventoryKlinikPage";
import { InventoryOliPage } from "./pages/InventoryOliPage";
import { MasterObatPage } from "./pages/MasterObatPage";
import { MasterOliPage } from "./pages/MasterOliPage";
import { UserActivityPage } from "./pages/UserActivityPage";
import { StokOpnamePage } from "./pages/StokOpnamePage";
import { StokOpnameDetailPage } from "./pages/StokOpnameDetailPage";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<MainLayout />}>
              {[
                { path: "/inventory-pupuk", estate: "NILAM" },
                { path: "/inventory-pupuk-kns", estate: "KNS" },
                { path: "/inventory-pupuk-wja", estate: "WJA" },
                { path: "/inventory-pupuk-zamrud", estate: "ZAMRUD" },
                { path: "/inventory-pupuk-firus", estate: "FIRUS" },
              ].map(({ path, estate }) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    <RequireEstate estate={estate}>
                      <InventoryPupukPage key={estate} estate={estate} />
                    </RequireEstate>
                  }
                />
              ))}
              {[
                { path: "/inventory-klinik", estate: "NILAM" },
                { path: "/inventory-klinik-kns", estate: "KNS" },
                { path: "/inventory-klinik-wja", estate: "WJA" },
                { path: "/inventory-klinik-zamrud", estate: "ZAMRUD" },
                { path: "/inventory-klinik-firus", estate: "FIRUS" },
              ].map(({ path, estate }) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    <RequireEstate estate={estate}>
                      <InventoryKlinikPage key={estate} klinik={estate} />
                    </RequireEstate>
                  }
                />
              ))}
              {[
                { path: "/inventory-oli", estate: "NILAM" },
                { path: "/inventory-oli-kns", estate: "KNS" },
                { path: "/inventory-oli-wja", estate: "WJA" },
                { path: "/inventory-oli-zamrud", estate: "ZAMRUD" },
                { path: "/inventory-oli-firus", estate: "FIRUS" },
              ].map(({ path, estate }) => (
                <Route
                  key={path}
                  path={path}
                  element={
                    <RequireEstate estate={estate}>
                      <InventoryOliPage key={estate} estate={estate} />
                    </RequireEstate>
                  }
                />
              ))}
              {/* Landing page for every account; it only shows the estates the account can open. */}
              <Route path="/" element={<DashboardPage />} />

              <Route
                path="/inventory"
                element={
                  <RequireEstate estate="NILAM">
                    <InventoryPage />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory/:id"
                element={
                  <RequireEstate estate="NILAM">
                    <ItemDetailPage />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-kns"
                element={
                  <RequireEstate estate="KNS">
                    <InventoryGudangStockPage gudang="KNS" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-wja"
                element={
                  <RequireEstate estate="WJA">
                    <InventoryGudangStockPage gudang="WJA" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-zamrud"
                element={
                  <RequireEstate estate="ZAMRUD">
                    <InventoryGudangStockPage gudang="ZAMRUD" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-firus"
                element={
                  <RequireEstate estate="FIRUS">
                    <InventoryGudangStockPage gudang="FIRUS" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm"
                element={
                  <RequireEstate estate="NILAM">
                    <InventoryBbmPage lokasiLock="NILAM" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm-kns"
                element={
                  <RequireEstate estate="KNS">
                    <InventoryBbmPage lokasiLock="KNS" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm-wja"
                element={
                  <RequireEstate estate="WJA">
                    <InventoryBbmPage lokasiLock="WJA" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm-zamrud"
                element={
                  <RequireEstate estate="ZAMRUD">
                    <InventoryBbmPage key="ZAMRUD" lokasiLock="ZAMRUD" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm-firus"
                element={
                  <RequireEstate estate="FIRUS">
                    <InventoryBbmPage key="FIRUS" lokasiLock="FIRUS" />
                  </RequireEstate>
                }
              />
              {/* The old Transaksi menu now lives as tabs on Inventory Gudang - Nilam. */}
              <Route path="/stock-in" element={<Navigate to="/inventory?tab=in" replace />} />
              <Route path="/stock-out" element={<Navigate to="/inventory?tab=out" replace />} />
              <Route path="/transactions" element={<Navigate to="/inventory?tab=in" replace />} />
              <Route path="/reports" element={<Navigate to="/inventory" replace />} />
              <Route
                path="/master-barang"
                element={
                  <RequirePageAccess>
                    <MasterBarangPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/master-obat"
                element={
                  <RequirePageAccess>
                    <MasterObatPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/master-oli"
                element={
                  <RequirePageAccess>
                    <MasterOliPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/karyawan"
                element={
                  <RequirePageAccess>
                    <KaryawanPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/alat-berat"
                element={
                  <RequirePageAccess>
                    <AlatBeratPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/users"
                element={
                  <RequirePageAccess>
                    <UsersPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/stok-opname"
                element={
                  <RequirePageAccess>
                    <StokOpnamePage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/stok-opname/:id"
                element={
                  <RequirePageAccess>
                    <StokOpnameDetailPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/log-user"
                element={
                  <RequirePageAccess>
                    <UserActivityPage />
                  </RequirePageAccess>
                }
              />

            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
