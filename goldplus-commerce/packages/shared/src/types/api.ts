export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    requestId?: string;
    [key: string]: unknown;
  };
};
