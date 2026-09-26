export class LinearApiError extends Error {
  override readonly name = 'LinearApiError';
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}
