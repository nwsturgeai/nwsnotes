/** An error caused by the request, reported to the website with this HTTP status. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
