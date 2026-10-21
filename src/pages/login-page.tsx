import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cs } from "@/i18n/cs"
import { ApiError, extractErrorMessage } from "@/lib/api"
import { useAuthStore } from "@/stores/auth-store"

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((s) => s.login)

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Shown inline: the login page sits outside the shells that mount <Toaster />,
  // so a toast here would only appear after the next successful login.
  const [error, setError] = useState<string | null>(null)
  // Success message handed over by another page, e.g. after a password reset.
  const notice = (location.state as { notice?: string } | null)?.notice

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      await login(username.trim(), password)
      const from = (location.state as { from?: Location })?.from
      navigate(from?.pathname ?? "/", { replace: true })
    } catch (err) {
      // The server's own wording is English; wrong credentials get the Czech text.
      setError(
        err instanceof ApiError && err.code === "unauthorized"
          ? cs.auth.loginError
          : extractErrorMessage(err, cs.auth.loginError),
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{cs.auth.loginTitle}</CardTitle>
          <CardDescription>{cs.auth.loginDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {notice && !error && (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            )}
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
              <Label htmlFor="password">{cs.auth.passwordLabel}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={cs.auth.passwordPlaceholder}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? cs.auth.loginButtonLoading : cs.auth.loginButton}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/register" className="underline">
                {cs.auth.noAccount}
              </Link>
            </p>
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/forgot-password" className="underline">
                {cs.auth.forgotPasswordLink}
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
