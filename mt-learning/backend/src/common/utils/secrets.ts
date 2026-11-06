import { createHash, randomBytes, randomInt } from 'node:crypto';
import * as argon2 from 'argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
export const hashSecret = (plain: string): Promise<string> =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }) as Promise<string>;

export async function verifySecret(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** A fixed hash used to keep login timing constant when the account does not exist. */
let dummyHash: Promise<string> | undefined;
export const dummySecretHash = () => (dummyHash ??= hashSecret(randomBytes(16).toString('hex')));

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export const newRefreshToken = () => randomBytes(48).toString('base64url');

// No ambiguous characters (0/O, 1/l/I) — temporary passwords are often read aloud or printed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Generates a temporary password meeting the password policy (has upper, lower and digit). */
export function temporaryPassword(length = 10): string {
  for (;;) {
    let out = '';
    for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /\d/.test(out)) return out;
  }
}

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
export const PASSWORD_RULE_MESSAGE = 'Password must be 8–128 characters and include at least one letter and one number';
export const PIN_RULE = /^\d{4,6}$/;
