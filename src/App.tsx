import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RequireEstate, RequireSuperuser } from "./components/AccessGate";
import { LoginPage } from "./pages/LoginPage";
import { MainLayout } from "./layouts/MainLayout";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryGudangStockPage } from "./pages/InventoryGudangStockPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { StockInPage } from "./pages/StockInPage";
import { StockOutPage } from "./pages/StockOutPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { KaryawanPage } from "./pages/KaryawanPage";
import { InventoryBbmPage } from "./pages/InventoryBbmPage";
import { AlatBeratPage } from "./pages/AlatBeratPage";
import { MasterBarangPage } from "./pages/MasterBarangPage";
import { UsersPage } from "./pages/UsersPage";
import { ActivityLogPage } from "./pages/ActivityLogPage";
import { DashboardPage } from "./pages/DashboardPage";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<MainLayout />}>
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
              <Route
                path="/stock-in"
                element={
                  <RequireEstate estate="NILAM">
                    <StockInPage />
                  </RequireEstate>
                }
              />
              <Route
                path="/stock-out"
                element={
                  <RequireEstate estate="NILAM">
                    <StockOutPage />
                  </RequireEstate>
                }
              />
              <Route
                path="/transactions"
                element={
                  <RequireEstate estate="NILAM">
                    <TransactionsPage />
                  </RequireEstate>
                }
              />
              <Route
                path="/reports"
                element={
                  <RequireEstate estate="NILAM">
                    <ReportsPage />
                  </RequireEstate>
                }
              />
              <Route
                path="/master-barang"
                element={
                  <RequireSuperuser>
                    <MasterBarangPage />
                  </RequireSuperuser>
                }
              />
              <Route
                path="/karyawan"
                element={
                  <RequireSuperuser>
                    <KaryawanPage />
                  </RequireSuperuser>
                }
              />
              <Route
                path="/alat-berat"
                element={
                  <RequireSuperuser>
                    <AlatBeratPage />
                  </RequireSuperuser>
                }
              />
              <Route
                path="/users"
                element={
                  <RequireSuperuser>
                    <UsersPage />
                  </RequireSuperuser>
                }
              />
              {/* Open to every account: the server scopes an estate user to their own estate's log. */}
              <Route path="/log-barang" element={<ActivityLogPage key="BARANG" module="BARANG" />} />
              <Route path="/log-bbm" element={<ActivityLogPage key="BBM" module="BBM" />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
