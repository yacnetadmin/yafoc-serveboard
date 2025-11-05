// Placeholder for API calls to Azure Functions

// Helper to call API with Bearer token
async function apiCall(url, method = "GET", body = null) {
  const token = await window.msalAuth.getAccessToken();
  if (!token) throw new Error("Not authenticated");
  const headers = { "Authorization": `Bearer ${token}` };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
window.api = { apiCall };