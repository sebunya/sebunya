export interface ProductFinderSession {
  id: string;
  userId: string | null;
  anonymousId: string | null;
  status: string;
  answers: Record<string, string | string[]>;
  recommendations: any[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductFinderRepository {
  createSession(params: { userId?: string; anonymousId?: string; status: string }): Promise<ProductFinderSession>;
  updateSessionAnswers(sessionId: string, answers: Record<string, string | string[]>): Promise<void>;
  completeSession(sessionId: string, recommendations: any[], status: string): Promise<void>;
  getSession(sessionId: string): Promise<ProductFinderSession | null>;
  listRecentSessionsForCustomer(userId: string): Promise<ProductFinderSession[]>;
}
