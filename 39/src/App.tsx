import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import Viewer from "@/pages/Viewer";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/viewer/:projectId" element={<Viewer />} />
      </Routes>
    </Router>
  );
}
