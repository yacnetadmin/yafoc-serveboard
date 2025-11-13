// admin-create-project-and-slot.js
// CLI helper to create projects and slots with Microsoft login via device code flow.
const readline = require("readline");
const fetch = global.fetch
  ? global.fetch.bind(global)
  : (...args) => import("node-fetch").then(({ default: fn }) => fn(...args));
const fs = require("fs");
const path = require("path");
const { PublicClientApplication } = require("@azure/msal-node");

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

const cachePath = path.join(__dirname, ".msal-cache.json");

function readConfigValue(key) {
  const candidateFiles = [
    path.resolve(__dirname, "..", "..", "docs", "config", "microsoft.json"),
    path.resolve(__dirname, "..", "..", "frontend", "config", "microsoft.json")
  ];
  for (const filePath of candidateFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && parsed[key]) {
        return parsed[key];
      }
    } catch (err) {
      if (err.code && err.code !== "ENOENT") {
        console.warn(`Failed to read ${filePath}: ${err.message}`);
      }
    }
  }
  return null;
}

const cachePlugin = {
  beforeCacheAccess: async cacheContext => {
    if (fs.existsSync(cachePath)) {
      const data = await fs.promises.readFile(cachePath, "utf8");
      cacheContext.tokenCache.deserialize(data);
    }
  },
  afterCacheAccess: async cacheContext => {
    if (cacheContext.cacheHasChanged) {
      await fs.promises.writeFile(cachePath, cacheContext.tokenCache.serialize(), "utf8");
    }
  }
};

let tenantId = (process.env.MICROSOFT_TENANT_ID || readConfigValue("tenantId") || "").trim();
let clientId = (process.env.MICROSOFT_CLIENT_ID || readConfigValue("clientId") || "").trim();
let scopes;
let msalApp;

async function ensureAuthInitialized() {
  if (!tenantId) {
    tenantId = (await prompt("Microsoft tenant ID (GUID): ")).trim();
  }
  if (!clientId) {
    clientId = (await prompt("Microsoft client ID (GUID): ")).trim();
  }
  if (!tenantId || !clientId) {
    console.error("Microsoft tenant and client IDs are required to continue.");
    process.exit(1);
  }
  process.env.MICROSOFT_TENANT_ID = tenantId;
  process.env.MICROSOFT_CLIENT_ID = clientId;

  if (!msalApp) {
    const authority = `https://login.microsoftonline.com/${tenantId}`;
    scopes = [process.env.MICROSOFT_SCOPE || `api://${clientId}/.default`];
    msalApp = new PublicClientApplication({
      auth: { clientId, authority },
      cache: { cachePlugin }
    });
  }
}

async function getAccessToken() {
  await ensureAuthInitialized();
  const accounts = await msalApp.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const silentResponse = await msalApp.acquireTokenSilent({ scopes, account: accounts[0] });
      return silentResponse.accessToken;
    } catch (silentError) {
      console.log("Cached token expired, requesting a new one...");
    }
  }

  console.log("\nSign in with your Microsoft account to call the admin API. Follow the device code instructions below.\n");
  const response = await msalApp.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback: info => {
      console.log(`To sign in, open ${info.verificationUri} and enter the code ${info.userCode}`);
      if (info.message) {
        console.log(info.message);
      }
    }
  });
  return response.accessToken;
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

async function listSlots(projectId) {
  const { status, data } = await apiCall(`/projects/${projectId}/slots`);
  if (status === 200 && Array.isArray(data)) {
    return data;
  }
  console.log("Error retrieving slots:", data.error || data);
  return [];
}

function printSlots(slots) {
  if (!slots.length) {
    console.log("No slots found for this project.");
    return;
  }
  slots.forEach((slot, idx) => {
    const volunteer = slot.volunteer
      ? `${slot.volunteer.firstName || ""} ${slot.volunteer.lastName || ""} <${slot.volunteer.email || ""}>`.trim()
      : "No volunteer";
    const when = [slot.date, slot.time].filter(Boolean).join(" ");
    console.log(`${idx + 1}. [${slot.id}] ${when} | ${slot.task || "(no task)"} | Status: ${slot.status || "unknown"} | ${volunteer}`);
  });
}

async function pickSlot(slots, actionLabel) {
  if (!slots.length) {
    console.log("No slots available.");
    return null;
  }
  printSlots(slots);
  const choice = (await prompt(`Select slot number to ${actionLabel}: `)).trim();
  if (!choice) {
    console.log("No selection made.");
    return null;
  }
  const index = Number(choice) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= slots.length) {
    console.log("Invalid selection.");
    return null;
  }
  return slots[index];
}

async function updateSlot(projectId) {
  const slots = await listSlots(projectId);
  const slot = await pickSlot(slots, "update");
  if (!slot) return;

  const payload = {};

  const task = (await prompt(`Task [${slot.task || ""}]: `)).trim();
  if (task) payload.task = task;

  const date = (await prompt(`Date (YYYY-MM-DD) [${slot.date || ""}]: `)).trim();
  if (date) payload.date = date;

  const time = (await prompt(`Time (e.g. 6:00 PM) [${slot.time || ""}]: `)).trim();
  if (time) {
    const parsed = parseTimeInput(time);
    if (!parsed) {
      console.log("Invalid time format; skipping time update.");
    } else {
      payload.time = parsed;
    }
  }

  const status = (await prompt(`Status [${slot.status || ""}]: `)).trim();
  if (status) payload.status = status;

  const volunteerChoice = (await prompt("Update volunteer info? (y/N): ")).trim().toLowerCase();
  if (volunteerChoice === "y") {
    const email = (await prompt(`Volunteer email (leave blank to remove) [${slot.volunteer?.email || "none"}]: `)).trim();
    if (!email) {
      payload.volunteer = null;
    } else {
      const firstName = (await prompt(`Volunteer first name [${slot.volunteer?.firstName || ""}]: `)).trim();
      const lastName = (await prompt(`Volunteer last name [${slot.volunteer?.lastName || ""}]: `)).trim();
      const phone = (await prompt(`Volunteer phone [${slot.volunteer?.phone || ""}]: `)).trim();
      payload.volunteer = {
        email,
        firstName,
        lastName,
        phone
      };
    }
  }

  if (Object.keys(payload).length === 0) {
    console.log("No changes entered; skipping update.");
    return;
  }

  const { status: responseStatus, data } = await apiCall(`/projects/${projectId}/slots/${slot.id}`, "PATCH", payload);
  if (responseStatus === 200) {
    console.log("Slot updated successfully.");
    printSlots([data.slot]);
  } else {
    console.log("Failed to update slot:", data.error || data);
  }
}

async function deleteSlot(projectId) {
  const slots = await listSlots(projectId);
  const slot = await pickSlot(slots, "delete");
  if (!slot) return;
  const confirmation = (await prompt(`Are you sure you want to delete slot '${slot.id}'? (y/N): `)).trim().toLowerCase();
  if (confirmation !== "y") {
    console.log("Deletion cancelled.");
    return;
  }

  const { status, data } = await apiCall(`/projects/${projectId}/slots/${slot.id}`, "DELETE");
  if (status === 204) {
    console.log("Slot deleted successfully.");
  } else {
    console.log("Failed to delete slot:", data.error || data);
  }
}

async function manageSlots(projectId) {
  while (true) {
    console.log("\nSlot management options:");
    console.log("1. List slots");
    console.log("2. Add a new slot");
    console.log("3. Update an existing slot");
    console.log("4. Delete a slot");
    console.log("0. Done");
    const choice = (await prompt("Choose an option: ")).trim();
    switch (choice) {
      case "1": {
        const slots = await listSlots(projectId);
        printSlots(slots);
        break;
      }
      case "2":
        await addSlot(projectId);
        break;
      case "3":
        await updateSlot(projectId);
        break;
      case "4":
        await deleteSlot(projectId);
        break;
      case "0":
        return;
      default:
        console.log("Unknown option, please try again.");
    }
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
  await manageSlots(projectId);
  console.log("Done.");
})();
