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

export interface ProductFinderPrincipal {
  userId?: string;
  accessToken?: string;
}

export interface ProductFinderRepository {
  createSession(params: {
    userId?: string;
    anonymousId?: string;
    status: string;
  }): Promise<ProductFinderSession>;
  updateSessionAnswer(
    sessionId: string,
    stepId: string,
    answer: string,
  ): Promise<boolean>;
  completeSession(
    sessionId: string,
    recommendations: any[],
    status: string,
  ): Promise<boolean>;
  getSession(sessionId: string): Promise<ProductFinderSession | null>;
  listRecentSessionsForCustomer(
    userId: string,
  ): Promise<ProductFinderSession[]>;
}
