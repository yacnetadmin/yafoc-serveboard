// MSAL.js v2 basic setup for SPA
// You must run `npm install @azure/msal-browser` and bundle, or use CDN in HTML
const msalConfig = {
  auth: {
    clientId: "1bad36bb-ea69-44f2-a2f5-0a23078b6715", // Fill from config
    authority: "https://login.microsoftonline.com/7be79f78-a660-436f-a2a5-de2c1068b6db", // Fill from config
    redirectUri: window.location.origin + window.location.pathname
  }
};
const msalInstance = new msal.PublicClientApplication(msalConfig);

async function signIn() {
  const loginRequest = { scopes: ["openid", "profile", "User.Read"] };
  try {
    const loginResponse = await msalInstance.loginPopup(loginRequest);
    return loginResponse.account;
  } catch (err) {
    alert("Login failed: " + err.message);
    return null;
  }
}

async function getAccessToken() {
  const account = msalInstance.getAllAccounts()[0];
  if (!account) return null;
  const tokenRequest = { scopes: ["api://1bad36bb-ea69-44f2-a2f5-0a23078b6715/.default"], account };
  try {
    const response = await msalInstance.acquireTokenSilent(tokenRequest);
    return response.accessToken;
  } catch (e) {
    // fallback to popup
    try {
      const response = await msalInstance.acquireTokenPopup(tokenRequest);
      return response.accessToken;
    } catch (err) {
      alert("Token acquisition failed: " + err.message);
      return null;
    }
  }
}
function signOut() {
  msalInstance.logoutRedirect({
    postLogoutRedirectUri: window.location.origin + "/yafoc-serveboard/logout.html"
  });
}
window.msalAuth = { signIn, getAccessToken, signOut };