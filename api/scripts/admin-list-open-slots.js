// admin-list-open-slots.js
// Lists all projects, lets you select one, then lists open slots for that project.
const { TableClient } = require("@azure/data-tables");
const readline = require("readline");

const connectionString = process.env.AzureWebJobsStorage || require("../local.settings.json").Values.AzureWebJobsStorage;

async function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

async function listProjects() {
  const client = TableClient.fromConnectionString(connectionString, "Projects");
  const projects = [];
  for await (const entity of client.listEntities()) {
    projects.push({
      id: entity.rowKey || entity.RowKey,
      category: entity.partitionKey || entity.PartitionKey,
      title: entity.Title,
      description: entity.Description
    });
  }
  return projects;
}

async function listOpenSlots(projectId) {
  const client = TableClient.fromConnectionString(connectionString, "Slots");
  const slots = [];
  const filter = `PartitionKey eq '${projectId}' and Status eq 'available'`;
  for await (const entity of client.listEntities({ queryOptions: { filter } })) {
    slots.push({
      id: entity.rowKey || entity.RowKey,
      task: entity.Task,
      date: entity.Date,
      time: entity.Time
    });
  }
  return slots;
}

async function signupForSlot(projectId, slotId, volunteerName, volunteerEmail) {
  const url = `http://localhost:7071/api/projects/${projectId}/slots/${slotId}/signup`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ volunteerName, volunteerEmail })
  });
  const data = await res.json();
  return { status: res.status, data };
}

function isValidEmail(email) {
  // Simple regex for email validation
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

(async () => {
  const projects = await listProjects();
  if (projects.length === 0) {
    console.log("No projects found.");
    return;
  }
  console.log("Available Projects:");
  projects.forEach((p, i) => {
    console.log(`${i + 1}. [${p.id}] ${p.title} (${p.category}) - ${p.description}`);
  });
  const choice = await prompt("Select a project by number: ");
  const idx = parseInt(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    console.log("Invalid selection.");
    return;
  }
  const project = projects[idx];
  const slots = await listOpenSlots(project.id);
  if (slots.length === 0) {
    console.log("No open slots for this project.");
    return;
  }
  console.log(`Open slots for project '${project.title}':`);
  slots.forEach((s, i) => {
    console.log(`${i + 1}. [${s.id}] ${s.task} on ${s.date} at ${s.time}`);
  });
  const slotChoice = await prompt("Select a slot by number: ");
  const slotIdx = parseInt(slotChoice) - 1;
  if (isNaN(slotIdx) || slotIdx < 0 || slotIdx >= slots.length) {
    console.log("Invalid slot selection.");
    return;
  }
  const slot = slots[slotIdx];
  const volunteerName = await prompt("Enter volunteer name: ");
  let volunteerEmail;
  do {
    volunteerEmail = await prompt("Enter volunteer email: ");
    if (!isValidEmail(volunteerEmail)) {
      console.log("Invalid email format. Please try again.");
    }
  } while (!isValidEmail(volunteerEmail));
  const result = await signupForSlot(project.id, slot.id, volunteerName, volunteerEmail);
  if (result.status === 200) {
    console.log(result.data.message);
  } else {
    console.log("Error:", result.data.error);
  }
})();
