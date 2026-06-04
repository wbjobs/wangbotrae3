import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { RealtimeMonitor } from "@/pages/RealtimeMonitor";
import { OfflineAnalysis } from "@/pages/OfflineAnalysis";
import { HistoryRecord } from "@/pages/HistoryRecord";
import { DeviceManagement } from "@/pages/DeviceManagement";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/monitor" replace />} />
          <Route path="/monitor" element={<RealtimeMonitor />} />
          <Route path="/analysis" element={<OfflineAnalysis />} />
          <Route path="/history" element={<HistoryRecord />} />
          <Route path="/devices" element={<DeviceManagement />} />
        </Route>
      </Routes>
    </Router>
  );
}
