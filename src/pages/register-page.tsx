import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cs } from "@/i18n/cs"
import { ApiError } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

// The server words its errors in English; map the ones a student can hit here
// (the browser already enforces username, password length and email format).
function registerErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "conflict") {
      return error.message.includes("email") ? cs.auth.emailTaken : cs.auth.usernameTaken
    }
    if (error.code === "validation" && error.message.includes("Invite code")) {
      return cs.auth.inviteCodeInvalid
    }
  }
  return cs.auth.registerError
}

export function RegisterPage() {
  const navigate = useNavigate()
  const register = useAuthStore((s) => s.register)

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [email, setEmail] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Inline, not a toast: no <Toaster /> is mounted outside the app shells.
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await register(username.trim(), password, inviteCode.trim(), email.trim() || undefined)
      navigate("/", { replace: true })
    } catch (err) {
      setError(registerErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{cs.auth.registerTitle}</CardTitle>
          <CardDescription>{cs.auth.registerDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="inviteCode">{cs.auth.inviteCodeLabel}</Label>
              <Input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder={cs.auth.inviteCodePlaceholder}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">{cs.auth.usernameLabel}</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={cs.auth.usernamePlaceholder}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{cs.auth.emailLabel}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={cs.auth.emailPlaceholder}
              />
              <p className="text-xs text-muted-foreground">{cs.auth.emailOptionalHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{cs.auth.passwordLabel}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={cs.auth.passwordPlaceholder}
                required
                minLength={8}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? cs.auth.registerButtonLoading : cs.auth.registerButton}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/login" className="underline">
                {cs.auth.haveAccount}
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
