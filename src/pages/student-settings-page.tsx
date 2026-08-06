import { Moon, Sun } from "lucide-react"

import { AccountCard } from "@/components/auth/account-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cs } from "@/i18n/cs"
import { useUiStore } from "@/stores/ui-store"

/**
 * A student's settings: their profile (username, role, password change — the
 * shared `AccountCard`, which is exactly what a teacher sees on their own
 * settings page) plus the theme toggle. Nothing here touches teacher-only
 * endpoints such as invite codes or the account list.
 */
export function StudentSettingsPage() {
  const isDark = useUiStore((state) => state.theme === "dark")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.student.settingsTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{cs.student.settingsDescription}</p>
      </div>

      <AccountCard />

      <Card>
        <CardHeader>
          <CardTitle>{cs.student.appearance}</CardTitle>
          <CardDescription>{cs.student.appearanceDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => useUiStore.getState().toggleTheme()}>
            {isDark ? <Sun className="size-4 mr-2" /> : <Moon className="size-4 mr-2" />}
            {isDark ? cs.theme.light : cs.theme.dark}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
