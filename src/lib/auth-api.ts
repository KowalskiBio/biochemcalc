import { httpRequest } from "./http"
import type {
  ChangePasswordInput,
  CreateInviteCodeInput,
  InviteCode,
  LoginInput,
  RegisterInput,
  User,
} from "./types"

/**
 * `/api/auth/*` — separate from `/api/cmd/*` because login/register are
 * public (no session yet) and `me`/`logout` are for either role, not just
 * teachers.
 */
export const authApi = {
  login: (input: LoginInput): Promise<User> => httpRequest<User>("/api/auth/login", input),

  register: (input: RegisterInput): Promise<User> =>
    httpRequest<User>("/api/auth/register", input),

  logout: (): Promise<void> => httpRequest<void>("/api/auth/logout"),

  me: (): Promise<User> => httpRequest<User>("/api/auth/me"),

  /**
   * Either role: change your own password. Requires the current password.
   */
  changePassword: (input: ChangePasswordInput): Promise<void> =>
    httpRequest<void>("/api/auth/change-password", input),

  /**
   * Teacher-only: mint an invite code for the given role, superseding
   * whatever code that role had before.
   */
  createInviteCode: (input: CreateInviteCodeInput): Promise<InviteCode> =>
    httpRequest<InviteCode>("/api/auth/invite-code", input),

  /**
   * Teacher-only: codes that can still be handed out (not expired, not revoked).
   */
  listInviteCodes: (): Promise<InviteCode[]> =>
    httpRequest<InviteCode[]>("/api/auth/invite-codes"),

  /**
   * Teacher-only: retire a code immediately.
   */
  revokeInviteCode: (code: string): Promise<void> =>
    httpRequest<void>("/api/auth/invite-codes/revoke", { code }),

  /**
   * Teacher-only: every registered account (teachers and students).
   */
  listUsers: (): Promise<User[]> => httpRequest<User[]>("/api/auth/users"),

  /**
   * Teacher-only: delete an account (not your own — the server rejects
   * that to avoid the last teacher locking themselves out).
   */
  deleteUser: (id: string): Promise<void> =>
    httpRequest<void>("/api/auth/users/delete", { id }),
}
