import { BrowserRouter, Routes, Route } from "react-router-dom";
import { MainLayout } from "./layouts/MainLayout";
import { InventoryPage } from "./pages/InventoryPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { StockInPage } from "./pages/StockInPage";
import { StockOutPage } from "./pages/StockOutPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { KaryawanPage } from "./pages/KaryawanPage";
import { InventoryBbmPage } from "./pages/InventoryBbmPage";
import { AlatBeratPage } from "./pages/AlatBeratPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<InventoryPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/:id" element={<ItemDetailPage />} />
          <Route path="/inventory-bbm" element={<InventoryBbmPage />} />
          <Route path="/stock-in" element={<StockInPage />} />
          <Route path="/stock-out" element={<StockOutPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/karyawan" element={<KaryawanPage />} />
          <Route path="/alat-berat" element={<AlatBeratPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
