// signup.js
// Handles volunteer signup UI and API calls

async function loadProjectsAndSlots() {
  const { status, data: projects } = await window.api.apiCall('/projects');
  if (status !== 200) {
    console.error('Failed to load projects:', projects);
    return;
  }
  const projectSelect = document.getElementById('projectSelect');
  projectSelect.innerHTML = '';
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.title} (${p.category})`;
    projectSelect.appendChild(opt);
  });
  if (projects.length > 0) {
    await loadSlotsForProject(projects[0].id);
  }
}

async function loadSlotsForProject(projectId) {
  const { status, data: slots } = await window.api.apiCall(`/projects/${projectId}/slots`);
  if (status !== 200) {
    console.error('Failed to load slots:', slots);
    return;
  }
  const slotSelect = document.getElementById('slotSelect');
  slotSelect.innerHTML = '';
  slots.filter(s => s.status === 'available').forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.task} (${s.date} ${s.time})`;
    slotSelect.appendChild(opt);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  loadProjectsAndSlots();
  document.getElementById('projectSelect').onchange = e => {
    loadSlotsForProject(e.target.value);
  };
  document.getElementById('signupForm').onsubmit = async e => {
    e.preventDefault();
    const form = e.target;
    const projectId = form.project.value;
    const slotId = form.slot.value;
    const name = form.name.value;
    const email = form.email.value;
    const { status, data } = await window.api.apiCall(`/projects/${projectId}/slots/${slotId}/signup`, 'POST', { 
      volunteerName: name, 
      volunteerEmail: email 
    });
    document.getElementById('signupMsg').innerText = data.message || data.error || '';
    if (res.status === 200) {
      form.reset();
      loadSlotsForProject(projectId);
    }
  };
});
