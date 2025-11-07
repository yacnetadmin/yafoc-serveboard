// admin-create-project-and-slot.js
// CLI helper to create projects and slots with Microsoft login via device code flow.
const readline = require("readline");
const fetch = require("node-fetch");
const { PublicClientApplication } = require("@azure/msal-node");

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

function readConfigValue(key) {
  const loaders = [
    () => require("../../docs/config/microsoft.json")[key],
    () => require("../../frontend/config/microsoft.json")[key]
  ];
  for (const load of loaders) {
    try {
      const value = load();
      if (value) return value;
    } catch (err) {
      if (err.code !== "MODULE_NOT_FOUND") {
        console.warn(`Failed to load ${key} from config file:`, err.message);
      }
    }
  }
  return null;
}

const tenantId = process.env.MICROSOFT_TENANT_ID || readConfigValue("tenantId");
const clientId = process.env.MICROSOFT_CLIENT_ID || readConfigValue("clientId");

if (!tenantId || !clientId) {
  throw new Error("Missing Microsoft identity configuration. Set MICROSOFT_TENANT_ID and MICROSOFT_CLIENT_ID.");
}

const scope = process.env.MICROSOFT_SCOPE || `api://${clientId}/user_impersonation`;
const authority = `https://login.microsoftonline.com/${tenantId}`;

const pca = new PublicClientApplication({
  auth: {
    clientId,
    authority
  }
});

let cachedAccessToken = null;
let cachedExpiresOn = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && cachedExpiresOn - 60000 > now) {
    return cachedAccessToken;
  }

  console.log("\nSign in with your Microsoft account to call the admin API.");
  console.log("Follow the device code instructions below.\n");

  try {
    const tokenResponse = await pca.acquireTokenByDeviceCode({
      scopes: [scope],
      deviceCodeCallback: info => {
        console.log(info.message);
      }
    });
    cachedAccessToken = tokenResponse.accessToken;
    cachedExpiresOn = tokenResponse.expiresOn ? tokenResponse.expiresOn.getTime() : 0;
    return cachedAccessToken;
  } catch (error) {
    console.error("Failed to acquire token via device code flow:", error);
    throw new Error("Microsoft sign-in failed. Please try again.");
  }
}

async function apiCall(path, method = "GET", body = null) {
  try {
    const token = await getAccessToken();
    const url = `https://yafoc-serveboard.azurewebsites.net/api${path}`;
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    };
    if (body) headers["Content-Type"] = "application/json";
    console.log(`Making ${method} request to ${url}`);
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    console.log(`Response status: ${res.status}`);
    console.log(`Response body: ${text}`);
    const data = text ? JSON.parse(text) : {};
    return { status: res.status, data };
  } catch (error) {
    console.error("API call failed:", error);
    return { status: 500, data: { error: error.message } };
  }
}

function parseTimeInput(input) {
  // Accepts '6:00 PM', '6 PM', '18:00', '18', etc. Returns 'HH:mm' 24-hour format.
  input = input.trim().toLowerCase();
  const ampmMatch = input.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1]);
    let minute = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0;
    if (ampmMatch[3] === 'pm' && hour !== 12) hour += 12;
    if (ampmMatch[3] === 'am' && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  // 24-hour format
  const militaryMatch = input.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (militaryMatch) {
    let hour = parseInt(militaryMatch[1]);
    let minute = militaryMatch[2] ? parseInt(militaryMatch[2]) : 0;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  return null;
}

async function createProject() {
  const title = await prompt("Project title: ");
  const description = await prompt("Project description: ");
  const contactEmail = await prompt("Contact email: ");
  const contactFirstName = await prompt("Contact first name: ");
  const contactLastName = await prompt("Contact last name: ");
  const contactPhone = await prompt("Contact phone: ");
  const category = await prompt("Category (or leave blank for 'General'): ");
  const payload = { title, description, contactEmail, contactFirstName, contactLastName, contactPhone, category };
  
  const { status, data } = await apiCall("/projects", "POST", payload);
  
  if (status === 201) {
    console.log("Project created! ID:", data.projectId);
    return { id: data.projectId, category: data.category };
  } else {
    console.log("Error:", data.error);
    return null;
  }
}

async function addSlot(projectId) {
  const task = await prompt("Slot task: ");
  const date = await prompt("Slot date (YYYY-MM-DD): ");
  let time;
  while (true) {
    const timeInput = await prompt("Slot time (e.g. 6:00 PM or 18:00): ");
    time = parseTimeInput(timeInput);
    if (time) break;
    console.log("Invalid time format. Please enter as '6:00 PM', '6 PM', '18:00', or '18'.");
  }
  
  const payload = { task, date, time };
  const { status, data } = await apiCall(`/projects/${projectId}/slots`, "POST", payload);
  
  if (status === 201) {
    console.log("Slot created! ID:", data.slotId);
  } else {
    console.log("Error:", data.error || data);
  }
}

async function listProjects() {
  const { status, data } = await apiCall("/projects");
  if (status === 200) {
    return data;
  } else {
    console.log("Error listing projects:", data.error);
    return [];
  }
}

(async () => {
  const projects = await listProjects();
  let projectId;
  if (projects.length > 0) {
    console.log("Available Projects:");
    projects.forEach((p, i) => {
      console.log(`${i + 1}. [${p.id}] ${p.title} (${p.category || ''}) - ${p.description}`);
    });
    const choice = await prompt("Select a project by number, or press Enter to create a new project: ");
    if (choice) {
      const idx = parseInt(choice) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < projects.length) {
        projectId = projects[idx].id;
      } else {
        console.log("Invalid selection.");
        return;
      }
    }
  }
  if (!projectId) {
    const project = await createProject();
    if (!project) return;
    projectId = project.id;
  }
  while (true) {
    await addSlot(projectId);
    const again = await prompt("Add another slot to this project? (y/n): ");
    if (again.trim().toLowerCase() !== "y") break;
  }
  console.log("Done.");
})();
