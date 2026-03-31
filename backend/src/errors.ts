export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class AuthError extends AppError {
  constructor(message = "Unauthorized request") {
    super(message, "AUTH_ERROR", 401);
  }
}

export class PermissionError extends AppError {
  constructor(message = "Origin is not allowed") {
    super(message, "PERMISSION_ERROR", 403);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid analyze payload", public readonly details?: unknown) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class TimeoutError extends AppError {
  constructor(message = "Analysis timed out") {
    super(message, "TIMEOUT_ERROR", 504);
  }
}

export class AnalysisError extends AppError {
  constructor(message = "Analysis provider failed") {
    super(message, "ANALYSIS_ERROR", 502);
  }
}
