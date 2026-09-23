export class MsaidiziInputBindingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MsaidiziInputBindingError';
  }
}
