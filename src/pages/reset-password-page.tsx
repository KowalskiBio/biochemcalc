import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cs } from "@/i18n/cs"
import { ApiError } from "@/lib/api"
import { authApi } from "@/lib/auth-api"

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") ?? ""

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tokenInvalid, setTokenInvalid] = useState(false)
  // Inline, not a toast: no <Toaster /> is mounted outside the app shells.
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError(cs.auth.resetPassword.mismatchError)
      return
    }
    setIsSubmitting(true)
    try {
      await authApi.resetPassword({ token, newPassword })
      navigate("/login", {
        replace: true,
        state: { notice: cs.auth.resetPassword.successMessage },
      })
    } catch (err) {
      // A bad or expired link swaps the form for its own Czech message.
      if (err instanceof ApiError && err.code === "validation") {
        setTokenInvalid(true)
      } else {
        setError(cs.auth.resetPassword.error)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{cs.auth.resetPassword.title}</CardTitle>
          <CardDescription>{cs.auth.resetPassword.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {tokenInvalid ? (
            <div className="space-y-4">
              <p className="text-sm">{cs.auth.resetPassword.invalidTokenError}</p>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/forgot-password" className="underline">
                  {cs.auth.resetPassword.requestNewLink}
                </Link>
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="newPassword">{cs.auth.resetPassword.newPasswordLabel}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={cs.auth.resetPassword.newPasswordPlaceholder}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">
                  {cs.auth.resetPassword.confirmPasswordLabel}
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={cs.auth.resetPassword.confirmPasswordPlaceholder}
                  required
                  minLength={8}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting || !token}>
                {isSubmitting
                  ? cs.auth.resetPassword.submitButtonLoading
                  : cs.auth.resetPassword.submitButton}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
