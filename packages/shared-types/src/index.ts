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

export type FindingCategory = 'code-smell' | 'security' | 'complexity' | 'architecture' | 'test-coverage' | 'api' | 'performance';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type MentorStatus =
  | 'ok'
  | 'cached'
  | 'fallback-invalid-json'
  | 'skipped-quota'
  | 'skipped-cap'
  | 'skipped-no-key'
  | 'skipped-unavailable'
  | 'not-applicable'
  | 'dry-run';

export interface MentorConcept {
  name: string;
  summary: string;
}

export interface MentorExplanation {
  explanation: string;
  whyItMatters: string;
  howToFix: string[];
  beforeCode: string | null;
  afterCode: string | null;
  concept: MentorConcept;
  generatedBy: string;
  promptVersion: number;
}

export interface FindingMetadata {
  mentor?: MentorExplanation;
  mentorStatus?: MentorStatus;
  [key: string]: any;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  file: string;
  lineStart: number;
  lineEnd: number;
  message: string;
  ruleId: string;
  metadata?: FindingMetadata;
}

export interface EnrichmentStats {
  eligible: number;
  groups: number;
  findingsEnriched: number;
  cached: number;
  apiCalls: number;
  groupsFirstPassValid: number;
  groupsRepaired: number;
  fallback: number;
  skippedQuota: number;
  skippedCap: number;
  droppedCode: number;
  referencedMissingFiles: number;
  suggestedNewFiles: number;
  durationMs: number;
  model: string;
  promptVersion: number;
  tokenUsage?: {
    promptTokens?: number;
    candidatesTokens?: number;
    totalTokens?: number;
  };
}

