import { RequestBodyTooLargeError } from "./request-body";

export function createInternalErrorResponse() {
  return Response.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}

export function createRequestErrorResponse(error: unknown) {
  if (error instanceof RequestBodyTooLargeError) {
    return Response.json(
      { error: "Request body is too large." },
      { status: 413 },
    );
  }

  return createInternalErrorResponse();
}
