export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
export function badRequest(message) {
  return json({ error: message }, 400);
}
export function unauthorized(message) {
  return json({ error: message }, 401);
}
export function forbidden(message) {
  return json({ error: message }, 403);
}
export function notFound(message = "Not found") {
  return json({ error: message }, 404);
}
export function conflict(message) {
  return json({ error: message }, 409);
}
