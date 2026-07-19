export function createInternalErrorResponse() {
  return Response.json(
    { error: "Internal server error." },
    { status: 500 },
  );
}
