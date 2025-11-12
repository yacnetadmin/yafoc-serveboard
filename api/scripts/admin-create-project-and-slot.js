// admin-create-project-and-slot.js
// Lets you create a project, then add slots to it, or add slots to an existing project.
const readline = require("readline");
const fetch = require("node-fetch");

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

let accessToken = null;

async function getAccessToken() {
  if (!accessToken) {
    console.log("\nTo get an access token:");
    console.log("1. Go to https://yacnetadmin.github.io/yafoc-serveboard/get-token.html");
    console.log("2. Click 'Get Token' and sign in if needed");
    console.log("3. Copy the token shown on the page\n");
    accessToken = await prompt("Paste the access token here: ");
  }
  return accessToken;
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
