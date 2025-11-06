// MSAL.js v2 basic setup for SPA
// You must run `npm install @azure/msal-browser` and bundle, or use CDN in HTML
const msalConfig = {
  auth: {
    clientId: "1bad36bb-ea69-44f2-a2f5-0a23078b6715",
    authority: "https://login.microsoftonline.com/7be79f78-a660-436f-a1a5-de2c1068b6db",
    redirectUri: "https://yacnetadmin.github.io/yafoc-serveboard/manage.html",
    navigateToLoginRequestUrl: false,
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false
    }
  },
  system: {
    loggerOptions: {
      logLevel: "Info",
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        console.log(`MSAL: ${level} - ${message}`);
      }
    }
  }
};
console.log("MSAL Config:", JSON.stringify(msalConfig, null, 2));
const msalInstance = new msal.PublicClientApplication(msalConfig);

async function signIn() {
  const loginRequest = {
    scopes: ["openid", "profile"],
    prompt: "select_account"
  };
  try {
    console.log("Starting sign-in process with config:", JSON.stringify(msalConfig, null, 2));
    
    const loginResponse = await msalInstance.loginPopup(loginRequest);
    console.log("Sign-in successful:", loginResponse);
    return loginResponse.account;
  } catch (err) {
    console.error("Login failed:", err);
    console.error("Error details:", {
      name: err.name,
      message: err.message,
      stack: err.stack,
      errorCode: err.errorCode,
      errorMessage: err.errorMessage,
      subError: err.subError
    });
    alert("Login failed: " + err.message + "\n\nPlease check the browser console for more details.");
    return null;
  }
}

async function getAccessToken() {
  console.log("Getting access token...");
  const accounts = msalInstance.getAllAccounts();
  console.log("Available accounts:", accounts);
  
  const account = accounts[0];
  if (!account) {
    console.log("No signed-in account found");
    return null;
  }

  const tokenRequest = { 
    scopes: ["openid", "profile", "api://1bad36bb-ea69-44f2-a2a5-0a23078b6715/.default"], 
    account 
  };
  
  try {
    console.log("Attempting silent token acquisition...");
    const response = await msalInstance.acquireTokenSilent(tokenRequest);
    console.log("Silent token acquisition successful");
    return response.accessToken;
  } catch (e) {
    console.log("Silent token acquisition failed, falling back to popup:", e);
    // fallback to popup
    try {
      const response = await msalInstance.acquireTokenPopup(tokenRequest);
      console.log("Popup token acquisition successful");
      return response.accessToken;
    } catch (err) {
      console.error("Token acquisition failed:", err);
      alert("Token acquisition failed: " + err.message + "\n\nPlease check the browser console for more details.");
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