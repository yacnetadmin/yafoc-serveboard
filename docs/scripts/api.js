// API calls to Azure Functions

// Base URL for Azure Functions (update this when deploying)
const API_BASE_URL = "https://yafoc-serveboard.azurewebsites.net";  // or your actual Azure Function URL

// Helper to call API with Bearer token
async function apiCall(path, method = "GET", body = null) {
  const token = await window.msalAuth.getAccessToken();
  if (!token) throw new Error("Not authenticated");
  
  const url = path.startsWith('http') ? path : API_BASE_URL + path;
  const headers = { 
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json"
  };
  
  if (body) headers["Content-Type"] = "application/json";
  
  console.log('Making API call:', { url, method, headers, body });
  
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
window.api = { apiCall };