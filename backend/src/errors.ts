export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function assertApp(condition: unknown, statusCode: number, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(statusCode, code, message)
}
