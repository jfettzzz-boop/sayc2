import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { ConnectionService } from './connection.service';
import { LocalApiService } from './local-api.service';

/**
 * Sends API requests where the connection setting says. Pages and services always ask for
 * /api/v1/..., so they work the same against the device's database or any server.
 * Runs after the auth interceptor, which relies on that same path.
 */
export const connectionInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/v1/')) return next(req);

  const connection = inject(ConnectionService);
  if (connection.isLocal()) return inject(LocalApiService).handle(req);

  const base = connection.serverUrl();
  return next(base ? req.clone({ url: base + req.url }) : req);
};
