export class GitLabApiError extends Error {
  override readonly name = "GitLabApiError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
