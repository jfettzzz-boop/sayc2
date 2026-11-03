import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

const TOKEN_KEY = 'sayc_token';

export const LOGIN_URL = '/api/v1/auth/login';

export interface AuthUser {
  id: string;
  user_name: string;
  user_email: string;
  user_state: string;
  role_id: string;
  role_name: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

/** Reads the expiry only, to route the user. The API is what actually verifies the token. */
function isExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)).exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(LOGIN_URL, { email, password }).pipe(
      tap(({ token }) => {
        localStorage.setItem(TOKEN_KEY, token);
        this.token.set(token);
      }),
    );
  }

  me(): Observable<AuthUser> {
    return this.http.get<AuthUser>('/api/v1/auth/me');
  }

  /** True while there is an unexpired token. An expired or unreadable one is discarded. */
  isAuthenticated(): boolean {
    const token = this.token();
    if (token && isExpired(token)) this.clearSession();
    return this.token() !== null;
  }

  clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
  }
}
