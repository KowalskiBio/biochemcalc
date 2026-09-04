import { useState } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cs } from "@/i18n/cs"
import { authApi } from "@/lib/auth-api"

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await authApi.forgotPassword({ email: email.trim() })
    } catch {
      // Deliberately ignored: the same success message is shown regardless
      // of whether the email exists or the request failed, so this page
      // never becomes a way to enumerate registered accounts.
    } finally {
      setIsSubmitting(false)
      setSubmitted(true)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{cs.auth.forgotPassword.title}</CardTitle>
          <CardDescription>{cs.auth.forgotPassword.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm">{cs.auth.forgotPassword.successMessage}</p>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="underline">
                  {cs.auth.forgotPassword.backToLogin}
                </Link>
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">{cs.auth.forgotPassword.emailLabel}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={cs.auth.forgotPassword.emailPlaceholder}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting
                  ? cs.auth.forgotPassword.submitButtonLoading
                  : cs.auth.forgotPassword.submitButton}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="underline">
                  {cs.auth.forgotPassword.backToLogin}
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
