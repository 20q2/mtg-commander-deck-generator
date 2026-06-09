// src/services/poll/types.ts
export type SuggestionStatus = 'open' | 'shipped';

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  status: SuggestionStatus;
  voteCount: number;
  devNote?: string;
  shippedVersion?: string;
  shippedAt?: string;
  createdAt: string;
}

export interface ListResponse {
  suggestions: Suggestion[];
  myVotes: string[];
}

export interface RateLimitedError {
  error: 'rate_limited';
  action: 'submit' | 'vote';
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
