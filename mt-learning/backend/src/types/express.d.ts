import type { AuthPrincipal } from '../common/auth-principal';

declare global {
  namespace Express {
    interface Request {
      principal?: AuthPrincipal;
    }
  }
}

export {};
