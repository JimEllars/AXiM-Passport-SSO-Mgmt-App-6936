export function createErrorResponse(code: string, message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: true,
      code,
      message,
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}
