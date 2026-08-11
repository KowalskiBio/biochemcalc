import { KeyRound, Loader2, Settings, Trash2, Users } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { AccountCard } from "@/components/auth/account-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { authApi } from "@/lib/auth-api"
import { extractErrorMessage, victorApi } from "@/lib/api"
import type { InviteCode, Role, User } from "@/lib/types"
import { useAuthStore } from "@/stores/auth-store"

const DEFAULT_API_BASE_URL = "https://api.moonshot.cn/v1/chat/completions"

function formatDateTime(value: string) {
  try {
    return new Date(value).toLocaleString("cs-CZ")
  } catch {
    return value
  }
}

/** Whole days left before a code expires, floored at 0. */
function daysUntil(value: string): number {
  const ms = new Date(value).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86_400_000))
}

function InviteCodeCard() {
  const { toast } = useToast()
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [generatingRole, setGeneratingRole] = useState<Role | null>(null)
  const [revokingCode, setRevokingCode] = useState<string | null>(null)

  const fetchCodes = useCallback(async () => {
    try {
      setCodes(await authApi.listInviteCodes())
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.inviteCode.loadError),
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchCodes()
  }, [fetchCodes])

  const handleGenerate = async (role: Role) => {
    setGeneratingRole(role)
    try {
      await authApi.createInviteCode({ role })
      toast({ title: cs.settings.inviteCode.generated, variant: "default" })
      await fetchCodes()
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.inviteCode.error),
        variant: "destructive",
      })
    } finally {
      setGeneratingRole(null)
    }
  }

  const handleRevoke = async (code: string) => {
    setRevokingCode(code)
    try {
      await authApi.revokeInviteCode(code)
      toast({ title: cs.settings.inviteCode.revoked, variant: "default" })
      await fetchCodes()
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.inviteCode.revokeError),
        variant: "destructive",
      })
    } finally {
      setRevokingCode(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" />
          {cs.settings.inviteCode.title}
        </CardTitle>
        <CardDescription>{cs.settings.inviteCode.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => handleGenerate("student")} disabled={generatingRole !== null}>
            {generatingRole === "student"
              ? cs.settings.inviteCode.generating
              : cs.settings.inviteCode.generateStudent}
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleGenerate("teacher")}
            disabled={generatingRole !== null}
          >
            {generatingRole === "teacher"
              ? cs.settings.inviteCode.generating
              : cs.settings.inviteCode.generateTeacher}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : codes.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">
            {cs.settings.inviteCode.emptyState}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{cs.settings.inviteCode.columns.code}</TableHead>
                <TableHead>{cs.settings.inviteCode.columns.role}</TableHead>
                <TableHead>{cs.settings.inviteCode.columns.expiresAt}</TableHead>
                <TableHead>{cs.settings.inviteCode.columns.useCount}</TableHead>
                <TableHead className="text-right">
                  {cs.settings.inviteCode.columns.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((invite) => (
                <TableRow key={invite.code}>
                  <TableCell className="font-mono text-base tabular tracking-wider">
                    {invite.code}
                  </TableCell>
                  <TableCell>
                    {invite.role === "teacher"
                      ? cs.settings.inviteCode.roleTeacher
                      : cs.settings.inviteCode.roleStudent}
                  </TableCell>
                  <TableCell>
                    {formatDateTime(invite.expiresAt)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      (
                      {cs.settings.inviteCode.daysLeft.replace(
                        "{days}",
                        String(daysUntil(invite.expiresAt)),
                      )}
                      )
                    </span>
                  </TableCell>
                  <TableCell className="tabular">{invite.useCount}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleRevoke(invite.code)}
                      disabled={revokingCode === invite.code}
                    >
                      {revokingCode === invite.code ? (
                        <Loader2 className="size-4 mr-1 animate-spin" />
                      ) : (
                        <Trash2 className="size-4 mr-1" />
                      )}
                      {cs.common.delete}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-sm text-muted-foreground">{cs.settings.inviteCode.copyHint}</p>
      </CardContent>
    </Card>
  )
}

function UsersCard() {
  const { toast } = useToast()
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    try {
      setUsers(await authApi.listUsers())
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.users.loadError),
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await authApi.deleteUser(id)
      toast({ title: cs.settings.users.deleted, variant: "default" })
      await fetchUsers()
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.users.deleteError),
        variant: "destructive",
      })
    } finally {
      setDeletingId(null)
    }
  }

  const formatDate = (value: string) => {
    try {
      return new Date(value).toLocaleString("cs-CZ")
    } catch {
      return value
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-5" />
          {cs.settings.users.title}
        </CardTitle>
        <CardDescription>{cs.settings.users.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">{cs.settings.users.emptyState}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{cs.settings.users.columns.username}</TableHead>
                <TableHead>{cs.settings.users.columns.role}</TableHead>
                <TableHead>{cs.settings.users.columns.createdAt}</TableHead>
                <TableHead className="text-right">{cs.settings.users.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id
                const isProtected = user.protected
                const disabledReason = isSelf
                  ? cs.settings.users.cannotDeleteSelf
                  : isProtected
                    ? cs.settings.users.cannotDeleteProtected
                    : undefined
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.username}
                      {isProtected && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({cs.settings.users.protectedBadge})
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.role === "teacher"
                        ? cs.settings.users.roleTeacher
                        : cs.settings.users.roleStudent}
                    </TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleDelete(user.id)}
                        disabled={isSelf || isProtected || deletingId === user.id}
                        title={disabledReason}
                      >
                        {deletingId === user.id ? (
                          <Loader2 className="size-4 mr-1 animate-spin" />
                        ) : (
                          <Trash2 className="size-4 mr-1" />
                        )}
                        {cs.common.delete}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  const { toast } = useToast()
  const [settings, setSettings] = useState({
    apiBaseUrl: "",
    apiKey: "",
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedSettings = await victorApi.getSettings()
        setSettings({
          apiBaseUrl: loadedSettings.apiBaseUrl || "",
          apiKey: loadedSettings.apiKey || "",
        })
      } catch (_error) {
        toast({
          title: cs.settings.victor.error,
          variant: "destructive",
        })
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [toast])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await victorApi.setSettings({
        apiBaseUrl: settings.apiBaseUrl.trim() || DEFAULT_API_BASE_URL,
        apiKey: settings.apiKey.trim(),
      })
      toast({
        title: cs.settings.victor.saved,
        variant: "default",
      })
    } catch (_error) {
      toast({
        title: cs.settings.victor.error,
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setSettings({
      apiBaseUrl: DEFAULT_API_BASE_URL,
      apiKey: "",
    })
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.settings.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{cs.settings.description}</p>
        </div>
        <p className="text-foreground-muted">{cs.common.loading}...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.settings.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{cs.settings.description}</p>
      </div>

      <div>
        <AccountCard />
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="size-5" />
              {cs.settings.victor.title}
            </CardTitle>
            <CardDescription>{cs.settings.victor.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiBaseUrl">{cs.settings.victor.apiBaseUrlLabel}</Label>
              <Input
                id="apiBaseUrl"
                type="text"
                value={settings.apiBaseUrl}
                onChange={(e) => setSettings((prev) => ({ ...prev, apiBaseUrl: e.target.value }))}
                placeholder={cs.settings.victor.apiBaseUrlPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">{cs.settings.victor.apiKeyLabel}</Label>
              <Input
                id="apiKey"
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={cs.settings.victor.apiKeyPlaceholder}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? cs.settings.victor.saving : cs.settings.victor.save}
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={isSaving}>
                {cs.common.cancel}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <InviteCodeCard />
      </div>

      <div>
        <UsersCard />
      </div>
    </div>
  )
}
