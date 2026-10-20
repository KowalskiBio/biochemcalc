import { KeyRound, Loader2, Plus, Trash2, Users } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { AccountCard } from "@/components/auth/account-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { extractErrorMessage } from "@/lib/api"
import { authApi } from "@/lib/auth-api"
import type { InviteCode, Role, SectionAccess, User } from "@/lib/types"
import { useAuthStore } from "@/stores/auth-store"

const SECTION_ACCESS_OPTIONS: SectionAccess[] = ["calculations", "biomolecules", "both"]

function SectionAccessSelect({
  id,
  value,
  onChange,
  disabled,
  options = SECTION_ACCESS_OPTIONS,
}: {
  id?: string
  value: SectionAccess
  onChange: (value: SectionAccess) => void
  disabled?: boolean
  options?: SectionAccess[]
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SectionAccess)} disabled={disabled}>
      <SelectTrigger id={id} className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {cs.sections.access[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: Role
  onChange: (value: Role) => void
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)} disabled={disabled}>
      <SelectTrigger className="w-[130px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="student">{cs.settings.users.roleStudent}</SelectItem>
        <SelectItem value="teacher">{cs.settings.users.roleTeacher}</SelectItem>
      </SelectContent>
    </Select>
  )
}

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
  // A teacher can only invite students into sections they reach themselves.
  const ownAccess = useAuthStore((s) => s.user?.sections ?? "both")
  const sectionOptions = ownAccess === "both" ? SECTION_ACCESS_OPTIONS : [ownAccess]
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sections, setSections] = useState<SectionAccess>(sectionOptions[0])
  const [isGenerating, setIsGenerating] = useState(false)
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

  const handleGenerate = async () => {
    setIsGenerating(true)
    try {
      await authApi.createInviteCode({ sections })
      toast({ title: cs.settings.inviteCode.generated, variant: "default" })
      await fetchCodes()
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.inviteCode.error),
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
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
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="inviteSections">{cs.settings.inviteCode.sectionsLabel}</Label>
            <SectionAccessSelect
              id="inviteSections"
              value={sections}
              onChange={setSections}
              disabled={isGenerating}
              options={sectionOptions}
            />
          </div>
          <Button onClick={() => void handleGenerate()} disabled={isGenerating}>
            {isGenerating
              ? cs.settings.inviteCode.generating
              : cs.settings.inviteCode.generateStudent}
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
                <TableHead>{cs.settings.inviteCode.columns.sections}</TableHead>
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
                  <TableCell>{cs.sections.access[invite.sections]}</TableCell>
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

const EMPTY_NEW_USER = {
  username: "",
  password: "",
  email: "",
  role: "student" as Role,
  sections: "calculations" as SectionAccess,
}

/**
 * Admin only: the one place accounts are created directly (the only way to
 * add a teacher), re-roled, re-scoped, or deleted.
 */
function AddUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}) {
  const { toast } = useToast()
  const [form, setForm] = useState(EMPTY_NEW_USER)
  const [isCreating, setIsCreating] = useState(false)

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      await authApi.createUser({
        username: form.username.trim(),
        password: form.password,
        email: form.email.trim() || undefined,
        role: form.role,
        sections: form.sections,
      })
      toast({ title: cs.settings.users.created, variant: "default" })
      setForm(EMPTY_NEW_USER)
      onOpenChange(false)
      await onCreated()
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.users.createError),
        variant: "destructive",
      })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{cs.settings.users.addTitle}</DialogTitle>
          <DialogDescription>{cs.settings.users.addDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newUsername">{cs.auth.usernameLabel}</Label>
            <Input
              id="newUsername"
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              placeholder={cs.auth.usernamePlaceholder}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">{cs.auth.passwordLabel}</Label>
            <Input
              id="newPassword"
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              placeholder={cs.auth.resetPassword.newPasswordPlaceholder}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newEmail">{cs.auth.emailLabel}</Label>
            <Input
              id="newEmail"
              type="email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              placeholder={cs.auth.emailPlaceholder}
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>{cs.settings.users.columns.role}</Label>
              <RoleSelect
                value={form.role}
                onChange={(role) =>
                  setForm((prev) => ({
                    ...prev,
                    role,
                    // Teachers usually manage everything; narrowing is a deliberate choice.
                    sections: role === "teacher" ? "both" : prev.sections,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newSections">{cs.settings.users.columns.sections}</Label>
              <SectionAccessSelect
                id="newSections"
                value={form.sections}
                onChange={(sections) => setForm((prev) => ({ ...prev, sections }))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            {cs.common.cancel}
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={isCreating || !form.username.trim() || !form.password}
          >
            {isCreating ? cs.settings.users.creating : cs.settings.users.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UsersCard() {
  const { toast } = useToast()
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)

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

  const handleUpdate = async (user: User, role: Role, sections: SectionAccess) => {
    setUpdatingId(user.id)
    try {
      const updated = await authApi.updateUser({ id: user.id, role, sections })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      toast({ title: cs.settings.users.updated, variant: "default" })
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.settings.users.updateError),
        variant: "destructive",
      })
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" />
              {cs.settings.users.title}
            </CardTitle>
            <CardDescription>{cs.settings.users.description}</CardDescription>
          </div>
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus className="size-4 mr-1" />
            {cs.settings.users.add}
          </Button>
        </div>
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
                <TableHead>{cs.settings.users.columns.sections}</TableHead>
                <TableHead>{cs.settings.users.columns.createdAt}</TableHead>
                <TableHead className="text-right">{cs.settings.users.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const isSelf = user.id === currentUser?.id
                const isProtected = user.protected
                const isBusy = updatingId === user.id
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
                    <TableCell
                      title={isProtected ? cs.settings.users.cannotEditProtected : undefined}
                    >
                      <RoleSelect
                        value={user.role}
                        onChange={(role) => void handleUpdate(user, role, user.sections)}
                        disabled={isProtected || isBusy}
                      />
                    </TableCell>
                    <TableCell
                      title={isProtected ? cs.settings.users.cannotEditProtected : undefined}
                    >
                      <SectionAccessSelect
                        value={user.sections}
                        onChange={(sections) => void handleUpdate(user, user.role, sections)}
                        disabled={isProtected || isBusy}
                      />
                    </TableCell>
                    <TableCell>{formatDateTime(user.createdAt)}</TableCell>
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
      <AddUserDialog open={isAddOpen} onOpenChange={setIsAddOpen} onCreated={fetchUsers} />
    </Card>
  )
}

export function SettingsPage() {
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false)

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
        <InviteCodeCard />
      </div>

      {isAdmin && (
        <div>
          <UsersCard />
        </div>
      )}
    </div>
  )
}
