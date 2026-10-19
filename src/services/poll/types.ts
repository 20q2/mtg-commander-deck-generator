// src/services/poll/types.ts
export type SuggestionStatus = 'open' | 'shipped';

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  status: SuggestionStatus;
  voteCount: number;
  /** Replies on this suggestion. Absent on responses from a pre-replies backend. */
  commentCount?: number;
  devNote?: string;
  shippedVersion?: string;
  shippedAt?: string;
  createdAt: string;
  /** Submitter's contact email — only present on admin-authenticated responses. */
  authorEmail?: string;
}

/** A reply in a suggestion's thread. Flat — replies attach to the suggestion, not to each other. */
export interface PollComment {
  id: string;
  suggestionId: string;
  body: string;
  /** Posted by the developer (admin bearer). */
  isDev: boolean;
  /** Posted by whoever submitted the suggestion. */
  isAuthor: boolean;
  /** Posted by this browser's anon id. */
  isMine: boolean;
  createdAt: string;
}

export interface CommentsResponse {
  comments: PollComment[];
}

export interface ListResponse {
  suggestions: Suggestion[];
  myVotes: string[];
}

export interface RateLimitedError {
  error: 'rate_limited';
  action: 'submit' | 'vote' | 'comment';
  limit: number;
}

export class PollApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}
