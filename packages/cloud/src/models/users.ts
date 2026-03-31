/**
 * @prufs/cloud - User CRUD operations
 */

import { query } from '../db.js';
import type { User, CreateUserInput } from '../types.js';
import { NotFoundError, ConflictError } from '../types.js';

export async function createUser(input: CreateUserInput): Promise<User> {
  try {
    const result = await query<User>(
      `INSERT INTO users (email, name)
       VALUES ($1, $2)
       RETURNING *`,
      [input.email.toLowerCase().trim(), input.name ?? null],
    );
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      throw new ConflictError(`User already exists: ${input.email}`);
    }
    throw err;
  }
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await query<User>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await query<User>(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  return result.rows[0] ?? null;
}

export async function updateUser(
  id: string,
  input: { name?: string; email?: string },
): Promise<User> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(input.name);
  }
  if (input.email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    params.push(input.email.toLowerCase().trim());
  }

  if (setClauses.length === 0) {
    const user = await getUserById(id);
    if (!user) throw new NotFoundError('User', id);
    return user;
  }

  params.push(id);
  const result = await query<User>(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params,
  );

  if (result.rows.length === 0) throw new NotFoundError('User', id);
  return result.rows[0];
}

export async function deleteUser(id: string): Promise<void> {
  const result = await query('DELETE FROM users WHERE id = $1', [id]);
  if (result.rowCount === 0) throw new NotFoundError('User', id);
}

/** Get or create a user by email - used during first API key creation / bootstrap */
export async function getOrCreateUser(email: string, name?: string): Promise<User> {
  const existing = await getUserByEmail(email);
  if (existing) return existing;
  return createUser({ email, name });
}
