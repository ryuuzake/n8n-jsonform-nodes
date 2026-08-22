/**
 * Submits the entered values to the webhook URL serving this page: the same
 * path answers GET (this page) and POST (submissions).
 */
export function submitSubmission(data: Record<string, unknown>): Promise<Response> {
  return fetch(window.location.href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
