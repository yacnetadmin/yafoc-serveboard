// MSAL.js v2 basic setup for SPA
// You must run `npm install @azure/msal-browser` and bundle, or use CDN in HTML
const currentPageUri = `${window.location.origin}${window.location.pathname}`;

const msalConfig = {
  auth: {
    clientId: "1bad36bb-ea69-44f2-a2f5-0a23078b6715",
    authority: "https://login.microsoftonline.com/7be79f78-a660-436f-a1a5-de2c1068b6db",
    redirectUri: currentPageUri,
    navigateToLoginRequestUrl: false
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false
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

const loginRequest = {
  scopes: ["openid", "profile"],
  prompt: "select_account"
};

const apiScopes = ["openid", "profile", "api://1bad36bb-ea69-44f2-a2f5-0a23078b6715/.default"];

const authListeners = [];

const notifyAuthListeners = (account) => {
  authListeners.forEach((callback) => {
    try {
      callback(account || null);
    } catch (err) {
      console.error("Auth listener error", err);
    }
  });
};

const getActiveAccount = () => {
  const activeAccount = msalInstance.getActiveAccount();
  if (activeAccount) return activeAccount;
  const accounts = msalInstance.getAllAccounts();
  return accounts.length ? accounts[0] : null;
};

msalInstance
  .handleRedirectPromise()
  .then((response) => {
    redirectInFlight = false;
    if (response?.account) {
      msalInstance.setActiveAccount(response.account);
      notifyAuthListeners(response.account);
      return;
    }
    const existingAccount = getActiveAccount();
    if (existingAccount) {
      notifyAuthListeners(existingAccount);
    }
  })
  .catch((err) => {
    redirectInFlight = false;
    console.error("MSAL redirect handling failed", err);
  });

let redirectInFlight = false;

const triggerRedirectSignIn = () => {
  if (redirectInFlight) {
    console.log("Redirect sign-in already in progress");
    return;
  }
  redirectInFlight = true;
  console.log("Starting redirect sign-in flow");
  msalInstance.loginRedirect(loginRequest).catch((error) => {
    redirectInFlight = false;
    console.error("Redirect sign-in failed", error);
  });
};

const shouldFallbackToRedirect = (error) => {
  const redirectCodes = new Set([
    "popup_window_error",
    "popup_window_open_error",
    "token_renewal_error",
    "interaction_in_progress",
    "interaction_required",
    "monitor_window_timeout",
    "user_cancelled"
  ]);
  return redirectCodes.has(error?.errorCode);
};

async function signIn() {
  const account = getActiveAccount();
  if (account) {
    notifyAuthListeners(account);
    return account;
  }

  triggerRedirectSignIn();
  return null;
}

async function getAccessToken() {
  console.log("Requesting access token");
  const account = getActiveAccount();
  if (!account) {
    console.log("No signed-in account detected; initiating redirect sign-in");
    triggerRedirectSignIn();
    return null;
  }

  const tokenRequest = {
    scopes: apiScopes,
    account,
    authenticationScheme: "bearer"
  };

  try {
    const response = await msalInstance.acquireTokenSilent(tokenRequest);
    return response.accessToken;
  } catch (error) {
    console.warn("Silent token acquisition failed", error);
    if (error instanceof msal.InteractionRequiredAuthError || shouldFallbackToRedirect(error)) {
      console.log("Redirecting for interactive token acquisition");
  redirectInFlight = true;
  await msalInstance.acquireTokenRedirect(tokenRequest);
  return null;
    }
    throw error;
  }
}

function signOut() {
  const postLogoutRedirectUri = new URL('logout.html', window.location.href).toString();
  notifyAuthListeners(null);
  msalInstance.logoutRedirect({ postLogoutRedirectUri });
}

function onAuthStateChanged(callback) {
  if (typeof callback === "function") {
    authListeners.push(callback);
    const account = getActiveAccount();
    if (account) {
      callback(account);
    }
  }
}

window.msalAuth = { signIn, getAccessToken, signOut, getActiveAccount, onAuthStateChanged };