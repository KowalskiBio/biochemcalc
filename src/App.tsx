import { useEffect } from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { RequireAuth } from "@/components/auth/route-guard"
import { AppShell } from "@/components/layout/app-shell"
import { StudentShell } from "@/components/layout/student-shell"
import { BulkImportPage } from "@/pages/bulk-import-page"
import { ConstantsPage } from "@/pages/constants-page"
import { DatabazePage } from "@/pages/databaze-page"
import { FormulasPage } from "@/pages/formulas-page"
import { HelpPage } from "@/pages/help-page"
import { HistoryPage } from "@/pages/history-page"
import { LoginPage } from "@/pages/login-page"
import { ProjektyPage } from "@/pages/projekty-page"
import { RegisterPage } from "@/pages/register-page"
import { ReportsPage } from "@/pages/reports-page"
import { SetDetailPage } from "@/pages/set-detail-page"
import { SettingsPage } from "@/pages/settings-page"
import { StudentLeaderboardPage } from "@/pages/student-leaderboard-page"
import { StudentPracticePage } from "@/pages/student-practice-page"
import { StudentSettingsPage } from "@/pages/student-settings-page"
import { StudentStreakActivePage } from "@/pages/student-streak-active-page"
import { StudentStreakResultsPage } from "@/pages/student-streak-results-page"
import { StudentStreakSetupPage } from "@/pages/student-streak-setup-page"
import { StudentTestModePage } from "@/pages/student-test-mode-page"
import { StudentTestPage } from "@/pages/student-test-page"
import { StudentTestResultsPage } from "@/pages/student-test-results-page"
import { StudentTestStartPage } from "@/pages/student-test-start-page"
import { TestyPage } from "@/pages/testy-page"
import { TopicDetailPage } from "@/pages/topic-detail-page"
import { TopicsPage } from "@/pages/topics-page"
import { VictorPage } from "@/pages/victor-page"
import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"

function TeacherRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/topics" replace />} />
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
        <Route path="/hlaseni" element={<ReportsPage />} />
        <Route path="/leaderboard" element={<StudentLeaderboardPage />} />
        <Route path="/victor" element={<VictorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/topics" replace />} />
      </Routes>
    </AppShell>
  )
}

/**
 * A student sees three destinations and nothing else: the practice question
 * generator, the leaderboard, and their own profile. Anything else redirects
 * back to the generator — the teacher pages all call `/api/cmd/*`, which is
 * teacher-only server-side, so there is nothing for a student to reach there.
 */
function StudentRoutes() {
  return (
    <StudentShell>
      <Routes>
        <Route path="/" element={<StudentPracticePage />} />
        <Route path="/test" element={<StudentTestModePage />} />
        <Route path="/test/cvicny" element={<StudentTestStartPage />} />
        <Route path="/test/cvicny/active" element={<StudentTestPage />} />
        <Route path="/test/cvicny/results" element={<StudentTestResultsPage />} />
        <Route path="/test/ucen" element={<StudentStreakSetupPage kind="apprentice" />} />
        <Route path="/test/mistr" element={<StudentStreakSetupPage kind="master" />} />
        <Route path="/test/streak/active" element={<StudentStreakActivePage />} />
        <Route path="/test/streak/results" element={<StudentStreakResultsPage />} />
        <Route path="/leaderboard" element={<StudentLeaderboardPage />} />
        <Route path="/settings" element={<StudentSettingsPage />} />
        <Route path="*" element={<StudentPracticePage />} />
      </Routes>
    </StudentShell>
  )
}

export function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    const theme = useUiStore.getState().theme
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              {user?.role === "teacher" ? <TeacherRoutes /> : <StudentRoutes />}
            </RequireAuth>
          }
        />
      </Routes>
    </div>
  )
}
