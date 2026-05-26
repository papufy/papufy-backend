export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

export function forbidden(message = "Acesso negado."): AppError {
  return new AppError(message, 403);
}

export function unauthorized(message = "Token inválido ou expirado."): AppError {
  return new AppError(message, 401);
}

export function badRequest(message: string): AppError {
  return new AppError(message, 400);
}
