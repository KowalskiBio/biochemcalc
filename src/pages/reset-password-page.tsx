import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, extractErrorMessage } from "@/lib/api"
import { authApi } from "@/lib/auth-api"

export function ResetPasswordPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get("token") ?? ""

  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [tokenInvalid, setTokenInvalid] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast({ title: cs.auth.resetPassword.mismatchError, variant: "destructive" })
      return
    }
    setIsSubmitting(true)
    try {
      await authApi.resetPassword({ token, newPassword })
      toast({ title: cs.auth.resetPassword.successMessage, variant: "default" })
      navigate("/login", { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.code === "validation") {
        setTokenInvalid(true)
      }
      toast({
        title: extractErrorMessage(error, cs.auth.resetPassword.invalidTokenError),
        variant: "destructive",
      })
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
