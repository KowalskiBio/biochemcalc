import { create } from "zustand"
import { authApi } from "@/lib/auth-api"
import type { User } from "@/lib/types"

/**
 * Auth state. Deliberately holds no session token — that lives only in the
 * `HttpOnly` session cookie, invisible to JS by design. `fetchMe()` is how
 * the app recovers `user` after a page reload (the cookie is already there;
 * this just asks the server who it belongs to).
 */
type AuthStatus = "unknown" | "authenticated" | "anonymous"

interface AuthState {
  user: User | null
  status: AuthStatus
  fetchMe: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string, inviteCode: string, email?: string) => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "unknown",

  fetchMe: async () => {
    try {
      const user = await authApi.me()
      set({ user, status: "authenticated" })
    } catch {
      set({ user: null, status: "anonymous" })
    }
  },

  login: async (username, password) => {
    const user = await authApi.login({ username, password })
    set({ user, status: "authenticated" })
  },

  register: async (username, password, inviteCode, email) => {
    const user = await authApi.register({ username, password, inviteCode, email })
    set({ user, status: "authenticated" })
  },

  logout: async () => {
    await authApi.logout()
    set({ user: null, status: "anonymous" })
  },
}))
