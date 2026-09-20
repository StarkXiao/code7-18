import { defineStore } from 'pinia';
import { api } from '../api';
import { getToken, setToken } from '../api/client';
import type { Role } from '../api/types';

interface AuthState {
  token: string | null;
  user: { id: string; username: string; displayName: string; role: Role } | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: getToken(),
    user: null,
  }),
  getters: {
    isLoggedIn: (s) => Boolean(s.token),
    canDispatch: (s) => s.user?.role === 'admin' || s.user?.role === 'dispatcher',
    isAdmin: (s) => s.user?.role === 'admin',
  },
  actions: {
    async login(username: string, password: string) {
      const res = await api.login(username, password);
      this.token = res.accessToken;
      this.user = res.user as AuthState['user'];
      setToken(res.accessToken);
    },
    /** 用 token 换取用户信息；失败则清空登录态 */
    async restore() {
      if (!this.token) return;
      try {
        const res = await fetch((import.meta.env.VITE_API_BASE ?? '/api/v1') + '/auth/me', {
          headers: { authorization: `Bearer ${this.token}` },
        });
        if (!res.ok) throw new Error();
        const payload = (await res.json()) as { user: AuthState['user'] };
        this.user = payload.user;
      } catch {
        this.logout();
      }
    },
    logout() {
      this.token = null;
      this.user = null;
      setToken(null);
    },
  },
});
