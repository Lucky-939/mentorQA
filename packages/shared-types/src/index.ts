/**
 * Shared TypeScript types for MentorQA.
 * These mirror the Prisma models and are shared across apps/web and apps/worker.
 * apps/api intentionally does NOT depend on this package (it uses Prisma types directly).
 */

/** Represents a MentorQA user, mirroring the Prisma User model. */
export interface User {
  id: string;
  githubId: string;
  username: string;
  email: string | null;
  createdAt: string; // ISO 8601 string (serialised from Date)
}

/** Represents a connected GitHub repository, mirroring the Prisma Repository model. */
export interface Repository {
  id: string;
  ownerId: string;
  githubRepoId: string;
  name: string;
  defaultBranch: string;
  createdAt: string; // ISO 8601 string
}

/** API response envelope used across web → api calls. */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

/** JWT payload shape returned by /auth/me */
export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
}
