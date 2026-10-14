import { httpRequest } from "./http"
import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  ChangePasswordInput,
  CreateInviteCodeInput,
  ForgotPasswordInput,
  InviteCode,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  Section,
  User,
} from "./types"

/**
 * `/api/auth/*` — separate from `/api/cmd/*` because login/register are
 * public (no session yet) and `me`/`logout` are for either role, not just
 * teachers.
 */
export const authApi = {
  login: (input: LoginInput): Promise<User> => httpRequest<User>("/api/auth/login", input),

  register: (input: RegisterInput): Promise<User> => httpRequest<User>("/api/auth/register", input),

  logout: (): Promise<void> => httpRequest<void>("/api/auth/logout"),

  me: (): Promise<User> => httpRequest<User>("/api/auth/me"),

  /**
   * Either role: change your own password. Requires the current password.
   */
  changePassword: (input: ChangePasswordInput): Promise<void> =>
    httpRequest<void>("/api/auth/change-password", input),

  /**
   * Always resolves, whether or not `email` belongs to an account — the
   * server deliberately never reveals that (see `do_forgot_password` in
   * `src-tauri/src/commands/auth.rs`). Don't "fix" this to surface a
   * not-found error; that would leak which emails are registered.
   */
  forgotPassword: (input: ForgotPasswordInput): Promise<void> =>
    httpRequest<void>("/api/auth/forgot-password", input),

  /**
   * Consumes a reset token minted by `forgotPassword`. Rejects with a
   * validation error if the token is missing, expired, or already used.
   */
  resetPassword: (input: ResetPasswordInput): Promise<void> =>
    httpRequest<void>("/api/auth/reset-password", input),

  /**
   * Either role: remember the section the user lands in. Rejects a section
   * outside the account's access. Returns the updated user.
   */
  setPreferredSection: (section: Section): Promise<User> =>
    httpRequest<User>("/api/auth/preferred-section", { section }),

  /**
   * Teacher-only: mint a student invite code for the given sections,
   * superseding whatever code that same scope had before.
   */
  createInviteCode: (input: CreateInviteCodeInput): Promise<InviteCode> =>
    httpRequest<InviteCode>("/api/auth/invite-code", input),

  /**
   * Teacher-only: codes that can still be handed out (not expired, not revoked).
   */
  listInviteCodes: (): Promise<InviteCode[]> => httpRequest<InviteCode[]>("/api/auth/invite-codes"),

  /**
   * Teacher-only: retire a code immediately.
   */
  revokeInviteCode: (code: string): Promise<void> =>
    httpRequest<void>("/api/auth/invite-codes/revoke", { code }),

  /**
   * Admin-only: every registered account (teachers and students).
   */
  listUsers: (): Promise<User[]> => httpRequest<User[]>("/api/auth/users"),

  /**
   * Admin-only: create an account directly — the only way to add a teacher.
   */
  createUser: (input: AdminCreateUserInput): Promise<User> =>
    httpRequest<User>("/api/auth/users/create", input),

  /**
   * Admin-only: change an account's role and section access.
   */
  updateUser: (input: AdminUpdateUserInput): Promise<User> =>
    httpRequest<User>("/api/auth/users/update", input),

  /**
   * Admin-only: delete an account (not your own, not the protected one).
   */
  deleteUser: (id: string): Promise<void> => httpRequest<void>("/api/auth/users/delete", { id }),
}
