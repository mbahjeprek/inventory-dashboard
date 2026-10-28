import { Suspense, lazy, type ComponentType } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { HomeGate, RequireEstate, RequirePageAccess } from "./components/AccessGate";
import { LoginPage } from "./pages/LoginPage";
import { MainLayout } from "./layouts/MainLayout";

// A tab opened before a deploy asks for page chunks that are gone: reload once to get the new build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function page<M extends Record<string, any>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  return lazy(() =>
    load().then(
      (m) => {
        try {
          sessionStorage.removeItem("chunk-reload");
        } catch {
          // ignore
        }
        return { default: m[name] as M[K] extends ComponentType<infer P> ? ComponentType<P> : never };
      },
      (e) => {
        let again = false;
        try {
          again = !sessionStorage.getItem("chunk-reload");
          if (again) sessionStorage.setItem("chunk-reload", "1");
        } catch {
          // ignore
        }
        if (!again) throw e;
        location.reload();
        return new Promise<never>(() => {});
      }
    )
  );
}
// Every page is its own chunk, loaded when it is first opened (MainLayout shows "Memuat..." meanwhile), so the
// first visit downloads only the shell instead of the whole app.
const InventoryPage = page(() => import("./pages/InventoryPage"), "InventoryPage");
const InventoryGudangStockPage = page(() => import("./pages/InventoryGudangStockPage"), "InventoryGudangStockPage");
const ItemDetailPage = page(() => import("./pages/ItemDetailPage"), "ItemDetailPage");
const KaryawanPage = page(() => import("./pages/KaryawanPage"), "KaryawanPage");
const InventoryBbmPage = page(() => import("./pages/InventoryBbmPage"), "InventoryBbmPage");
const AlatBeratPage = page(() => import("./pages/AlatBeratPage"), "AlatBeratPage");
const MasterBlokPage = page(() => import("./pages/MasterBlokPage"), "MasterBlokPage");
const PetaBlokPage = page(() => import("./pages/PetaBlokPage"), "PetaBlokPage");
const MasterBarangPage = page(() => import("./pages/MasterBarangPage"), "MasterBarangPage");
const KoperasiPage = page(() => import("./pages/KoperasiPage"), "KoperasiPage");
const KendaraanPage = page(() => import("./pages/KendaraanPage"), "KendaraanPage");
const UsersPage = page(() => import("./pages/UsersPage"), "UsersPage");
const DashboardPage = page(() => import("./pages/DashboardPage"), "DashboardPage");
const InventoryPupukPage = page(() => import("./pages/InventoryPupukPage"), "InventoryPupukPage");
const InventoryKlinikPage = page(() => import("./pages/InventoryKlinikPage"), "InventoryKlinikPage");
const InventoryOliPage = page(() => import("./pages/InventoryOliPage"), "InventoryOliPage");
const MasterObatPage = page(() => import("./pages/MasterObatPage"), "MasterObatPage");
const MasterOliPage = page(() => import("./pages/MasterOliPage"), "MasterOliPage");
const MasterPupukPage = page(() => import("./pages/MasterPupukPage"), "MasterPupukPage");
const DokumenPage = page(() => import("./pages/DokumenPage"), "DokumenPage");
const SopPage = page(() => import("./pages/SopPage"), "SopPage");
const SopDokumenPage = page(() => import("./pages/SopDokumenPage"), "SopDokumenPage");
const PersetujuanPage = page(() => import("./pages/PersetujuanPage"), "PersetujuanPage");
const SemuaEstatePage = page(() => import("./pages/SemuaEstatePage"), "SemuaEstatePage");
const UserActivityPage = page(() => import("./pages/UserActivityPage"), "UserActivityPage");
const StokOpnamePage = page(() => import("./pages/StokOpnamePage"), "StokOpnamePage");
const PinjamanPage = page(() => import("./pages/PinjamanPage"), "PinjamanPage");
const MasterPasienPage = page(() => import("./pages/MasterPasienPage"), "MasterPasienPage");
const StokOpnameDetailPage = page(() => import("./pages/StokOpnameDetailPage"), "StokOpnameDetailPage");

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={null}>
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
              <Route
                path="/"
                element={
                  <HomeGate>
                    <DashboardPage />
                  </HomeGate>
                }
              />

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
                    <InventoryGudangStockPage key="KNS" gudang="KNS" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-wja"
                element={
                  <RequireEstate estate="WJA">
                    <InventoryGudangStockPage key="WJA" gudang="WJA" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-zamrud"
                element={
                  <RequireEstate estate="ZAMRUD">
                    <InventoryGudangStockPage key="ZAMRUD" gudang="ZAMRUD" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-firus"
                element={
                  <RequireEstate estate="FIRUS">
                    <InventoryGudangStockPage key="FIRUS" gudang="FIRUS" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm"
                element={
                  <RequireEstate estate="NILAM">
                    <InventoryBbmPage key="NILAM" lokasiLock="NILAM" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm-kns"
                element={
                  <RequireEstate estate="KNS">
                    <InventoryBbmPage key="KNS" lokasiLock="KNS" />
                  </RequireEstate>
                }
              />
              <Route
                path="/inventory-bbm-wja"
                element={
                  <RequireEstate estate="WJA">
                    <InventoryBbmPage key="WJA" lokasiLock="WJA" />
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
              <Route path="/semua-estate/:modul" element={<SemuaEstatePage />} />
              <Route
                path="/dokumen"
                element={
                  <RequirePageAccess>
                    <DokumenPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/sop"
                element={
                  <RequirePageAccess>
                    <SopPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/persetujuan"
                element={
                  <RequirePageAccess>
                    <PersetujuanPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/sop/:id"
                element={
                  <RequirePageAccess>
                    <SopDokumenPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/master-pupuk"
                element={
                  <RequirePageAccess>
                    <MasterPupukPage />
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
                path="/master-blok"
                element={
                  <RequirePageAccess>
                    <MasterBlokPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/peta-blok"
                element={
                  <RequirePageAccess>
                    <PetaBlokPage />
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
              {/* Laporan Harian Klinik lives in each estate's Klinik page now. */}
              <Route path="/laporan-klinik" element={<Navigate to="/inventory-klinik?tab=laporan" replace />} />
              <Route
                path="/master-pasien"
                element={
                  <RequirePageAccess>
                    <MasterPasienPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/pinjaman"
                element={
                  <RequirePageAccess>
                    <PinjamanPage />
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
                path="/koperasi"
                element={
                  <RequirePageAccess>
                    <KoperasiPage />
                  </RequirePageAccess>
                }
              />
              <Route
                path="/kendaraan"
                element={
                  <RequirePageAccess>
                    <KendaraanPage />
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
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
