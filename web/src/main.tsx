import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
const Workbench = lazy(() => import("./App"));
import Showcase from "./showcase/Showcase";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).has("workbench")
      ? <Suspense fallback={<p>正在打开本地工作台…</p>}><Workbench /></Suspense>
      : <Showcase />}
  </StrictMode>,
);
