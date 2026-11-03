import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface ManagedUser {
  id: string;
  user_name: string;
  user_email: string;
  user_state: string;
  role_id: string;
  role_name: string;
  user_created_at: string;
  user_updated_at: string;
}

export interface Role {
  id: string;
  role_name: string;
  role_description: string | null;
}

export interface NewUser {
  user_name: string;
  user_email: string;
  role_id: string;
  password: string;
}

export type UserChanges = Partial<NewUser> & { user_state?: string };

export const USERS_PAGE_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/v1/users';

  list(offset: number): Observable<ManagedUser[]> {
    return this.http.get<ManagedUser[]>(this.url, {
      params: { limit: USERS_PAGE_SIZE, offset },
    });
  }

  roles(): Observable<Role[]> {
    return this.http.get<Role[]>('/api/v1/roles');
  }

  create(user: NewUser): Observable<ManagedUser> {
    return this.http.post<ManagedUser>(this.url, user);
  }

  update(id: string, changes: UserChanges): Observable<ManagedUser> {
    return this.http.patch<ManagedUser>(`${this.url}/${id}`, changes);
  }
}
