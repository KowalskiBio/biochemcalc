import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/api"
import { authApi } from "@/lib/auth-api"
import { useAuthStore } from "@/stores/auth-store"

/**
 * Shared between the teacher Settings page and the student placeholder page
 * — both roles can see their own username and change their password, so
 * this doesn't live inside either role's own page tree.
 */
export function AccountCard() {
  const { toast } = useToast()
  const user = useAuthStore((s) => s.user)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  if (!user) {
    return null
  }

  const roleLabel =
    user.role === "teacher" ? cs.settings.users.roleTeacher : cs.settings.users.roleStudent

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      toast({ title: cs.auth.account.passwordChanged, variant: "default" })
      setCurrentPassword("")
      setNewPassword("")
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.auth.account.passwordChangeError),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{cs.auth.account.title}</CardTitle>
        <CardDescription>{cs.auth.account.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div className="space-y-1">
            <Label>{cs.auth.account.usernameLabel}</Label>
            <p className="text-sm font-medium">{user.username}</p>
          </div>
          <div className="space-y-1">
            <Label>{cs.auth.account.roleLabel}</Label>
            <p className="text-sm font-medium">{roleLabel}</p>
          </div>
        </div>

        <form className="space-y-4 max-w-sm" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="currentPassword">{cs.auth.account.currentPasswordLabel}</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={cs.auth.account.currentPasswordPlaceholder}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">{cs.auth.account.newPasswordLabel}</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={cs.auth.account.newPasswordPlaceholder}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? cs.auth.account.changingPassword : cs.auth.account.changePassword}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
