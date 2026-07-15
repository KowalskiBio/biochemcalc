import { AnimatePresence, motion } from "framer-motion"
import { Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/layout/app-shell"
import { BulkImportPage } from "@/pages/bulk-import-page"
import { ConstantsPage } from "@/pages/constants-page"
import { DatabazePage } from "@/pages/databaze-page"
import { FormulasPage } from "@/pages/formulas-page"
import { HelpPage } from "@/pages/help-page"
import { HistoryPage } from "@/pages/history-page"
import { HomePage } from "@/pages/home"
import { ProjektyPage } from "@/pages/projekty-page"
import { SetDetailPage } from "@/pages/set-detail-page"
import { SettingsPage } from "@/pages/settings-page"
import { TestyPage } from "@/pages/testy-page"
import { TopicDetailPage } from "@/pages/topic-detail-page"
import { TopicsPage } from "@/pages/topics-page"
import { VictorPage } from "@/pages/victor-page"

export function App() {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="min-h-screen bg-background"
      >
        <AppShell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/topics" element={<TopicsPage />} />
            <Route path="/topics/:topicId" element={<TopicDetailPage />} />
            <Route path="/sets/:setId" element={<SetDetailPage />} />
            <Route path="/projekty" element={<ProjektyPage />} />
            <Route path="/testy" element={<TestyPage />} />
            <Route path="/databaze" element={<DatabazePage />} />
            <Route path="/vzorce" element={<FormulasPage />} />
            <Route path="/bulk-import" element={<BulkImportPage />} />
            <Route path="/constants" element={<ConstantsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/victor" element={<VictorPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </AppShell>
      </motion.div>
    </AnimatePresence>
  )
}
