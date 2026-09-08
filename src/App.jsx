import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { DocumentDrawer } from "./components/DocumentDrawer";
import { SearchPalette } from "./components/SearchPalette";
import { DailyHotPage } from "./pages/DailyHotPage";
import { MaterialsPage } from "./pages/MaterialsPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { ContentGeneratePage } from "./pages/ContentGeneratePage";
import { ContentReviewPage } from "./pages/ContentReviewPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SystemPage } from "./pages/SystemPage";
import { SocialInsightsPage, SocialTrendDetailPage } from "./pages/SocialInsightsPage";
import { useVaultSync } from "./hooks/useVaultSync";

const localWorkbench = import.meta.env.VITE_WORKBENCH_HOSTED !== "true";

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState(null);
  const [readerContext, setReaderContext] = useState(null);
  const vaultSync = useVaultSync(location.pathname);
  const routeRevision =
    location.pathname.startsWith("/social-insights")
    ? location.pathname
    : `${location.pathname}:${vaultSync.revision}`;

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setSelectedDocumentId(null);
    setReaderContext(null);
  }, [location.pathname]);

  const openDocument = useCallback((documentOrId) => {
    const id =
      typeof documentOrId === "string"
        ? documentOrId
        : documentOrId?.id ?? documentOrId?.relativePath;
    if (id) {
      setSelectedDocumentId(id);
      setReaderContext(
        typeof documentOrId === "object" ? documentOrId.readerContext || null : null,
      );
    }
  }, []);

  const appContext = useMemo(
    () => ({
      navigate,
      openDocument,
      openSearch: () => setSearchOpen(true),
    }),
    [navigate, openDocument],
  );

  return (
    <>
      <AppShell onOpenSearch={appContext.openSearch} sync={vaultSync}>
        <Routes key={routeRevision}>
          <Route path="/" element={<OverviewPage onOpenDocument={openDocument} />} />
          <Route path="/content-generate" element={<ContentGeneratePage />} />
          <Route path="/content-review" element={<ContentReviewPage />} />
          <Route
            path="/materials"
            element={<MaterialsPage onOpenDocument={openDocument} />}
          />
          <Route path="/knowledge" element={<KnowledgePage initialPart="car" />} />
          <Route path="/knowledge/car" element={<KnowledgePage initialPart="car" />} />
          <Route path="/knowledge/creation" element={<KnowledgePage initialPart="creation" />} />
          <Route path="/daily-hot" element={<DailyHotPage />} />
          {localWorkbench ? (
            <Route
              path="/social-insights"
              element={
                <SocialInsightsPage
                  onOpenDocument={openDocument}
                  syncRevision={vaultSync.revision}
                />
              }
            />
          ) : null}
          {localWorkbench ? (
            <Route
              path="/social-insights/trends/:trendId"
              element={
                <SocialTrendDetailPage
                  onOpenDocument={openDocument}
                  syncRevision={vaultSync.revision}
                />
              }
            />
          ) : null}
          {localWorkbench ? (
            <Route
              path="/social-insights/:reportId"
              element={
                <SocialInsightsPage
                  onOpenDocument={openDocument}
                  syncRevision={vaultSync.revision}
                />
              }
            />
          ) : null}
          <Route path="/system" element={<SystemPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </AppShell>

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenDocument={(document) => {
          openDocument(document);
          setSearchOpen(false);
        }}
      />

      <DocumentDrawer
        documentId={selectedDocumentId}
        onNavigateDocument={openDocument}
        onClose={() => {
          setSelectedDocumentId(null);
          setReaderContext(null);
        }}
        readingContext={readerContext}
      />
    </>
  );
}
