// admin-create-project-and-slot.js
// Lets you create a project, then add slots to it, or add slots to an existing project.
const readline = require("readline");

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
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
  const fetch = global.fetch;
  const title = await prompt("Project title: ");
  const description = await prompt("Project description: ");
  const contactEmail = await prompt("Contact email: ");
  const contactFirstName = await prompt("Contact first name: ");
  const contactLastName = await prompt("Contact last name: ");
  const contactPhone = await prompt("Contact phone: ");
  const category = await prompt("Category (or leave blank for 'General'): ");
  const payload = { title, description, contactEmail, contactFirstName, contactLastName, contactPhone, category };
  const res = await fetch("http://localhost:7071/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (res.status === 201) {
    console.log("Project created! ID:", data.projectId);
    return { id: data.projectId, category: data.category };
  } else {
    console.log("Error:", data.error);
    return null;
  }
}

async function addSlot(projectId) {
  const fetch = global.fetch;
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
  let res, data;
  try {
    res = await fetch(`http://localhost:7071/api/projects/${projectId}/slots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log("Server did not return valid JSON. Status:", res.status, "Body:", text);
      return;
    }
  } catch (err) {
    console.log("Network or fetch error:", err);
    return;
  }
  if (res.status === 201) {
    console.log("Slot created! ID:", data.slotId);
  } else {
    console.log("Error:", data.error || data);
  }
}

async function listProjects() {
  const fetch = global.fetch;
  const res = await fetch("http://localhost:7071/api/projects");
  const projects = await res.json();
  return projects;
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
