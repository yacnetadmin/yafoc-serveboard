(() => {
  const DEFAULT_REMOTE_API = 'https://yafoc-serveboard.azurewebsites.net/api';
  const DEFAULT_LOCAL_API = 'http://localhost:7071/api';
  const configuredApiBase = window.serveboard?.apiBaseUrl;
  const apiBaseUrl = (configuredApiBase || (window.location.hostname === 'localhost' ? DEFAULT_LOCAL_API : DEFAULT_REMOTE_API)).replace(/\/$/, '');

  const projectSelect = document.getElementById('projectSelect');
  const slotSelect = document.getElementById('slotSelect');
  const signupForm = document.getElementById('signupForm');
  const signupMsg = document.getElementById('signupMsg');
  const slotNotice = document.getElementById('slotNotice');
  const submitBtn = document.getElementById('submitBtn');

  const setSignupMessage = (message, type) => {
    signupMsg.textContent = message || '';
    signupMsg.classList.remove('status-message--error', 'status-message--success');
    if (!message) return;
    if (type === 'error') {
      signupMsg.classList.add('status-message--error');
    } else if (type === 'success') {
      signupMsg.classList.add('status-message--success');
    }
  };

  const setSlotNotice = (message) => {
    slotNotice.textContent = message || '';
  };

  const createOption = (value, label, { disabled = false, selected = false } = {}) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.disabled = disabled;
    option.selected = selected;
    return option;
  };

  const resetSlotSelect = (placeholder, disable = true) => {
    slotSelect.innerHTML = '';
    slotSelect.appendChild(createOption('', placeholder, { disabled: true, selected: true }));
    slotSelect.disabled = disable;
  };

  const fetchJson = async (url, options = {}) => {
    const mergedOptions = {
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      },
      ...options
    };

    const response = await fetch(url, mergedOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || data?.message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  };

  const populateProjectSelect = (projects) => {
    projectSelect.innerHTML = '';
    if (!projects.length) {
      projectSelect.appendChild(createOption('', 'No projects available right now', { disabled: true, selected: true }));
      projectSelect.disabled = true;
      submitBtn.disabled = true;
      return;
    }

    projectSelect.appendChild(createOption('', 'Select a project', { disabled: true, selected: true }));
    projects.forEach((project) => {
      const label = project.category ? `${project.title} (${project.category})` : project.title;
      projectSelect.appendChild(createOption(project.id, label));
    });
    projectSelect.disabled = false;
  };

  const loadProjects = async () => {
    projectSelect.disabled = true;
    resetSlotSelect('Select a project first');
    submitBtn.disabled = true;
    setSlotNotice('');
    setSignupMessage('', null);

    try {
      const projects = await fetchJson(`${apiBaseUrl}/projects`);
      const projectList = Array.isArray(projects) ? projects : [];
      populateProjectSelect(projectList);

      if (projectList.length) {
        const firstProjectId = projectList[0].id;
        projectSelect.value = firstProjectId;
        await loadSlotsForProject(firstProjectId);
      } else {
        setSlotNotice('There are currently no volunteer projects accepting signups.');
      }
    } catch (error) {
      console.error('Failed to load projects', error);
      populateProjectSelect([]);
      setSignupMessage('Unable to load volunteer projects right now. Please try again a little later.', 'error');
    }
  };

  const loadSlotsForProject = async (projectId) => {
    if (!projectId) {
      resetSlotSelect('Select a project first');
      submitBtn.disabled = true;
      return;
    }

    resetSlotSelect('Loading slots...', true);
    submitBtn.disabled = true;
    setSlotNotice('');

    try {
      const slots = await fetchJson(`${apiBaseUrl}/projects/${projectId}/slots`);
      const availableSlots = (Array.isArray(slots) ? slots : []).filter((slot) => (slot.status || '').toLowerCase() === 'available');

      if (!availableSlots.length) {
        resetSlotSelect('No available slots at the moment');
        setSlotNotice('All slots for this project are currently filled. Please choose another project.');
        submitBtn.disabled = true;
        return;
      }

      slotSelect.innerHTML = '';
      slotSelect.appendChild(createOption('', 'Select a slot', { disabled: true, selected: true }));
      availableSlots.forEach((slot) => {
        const parts = [slot.task || 'Volunteer slot'];
        if (slot.date) parts.push(slot.date);
        if (slot.time) parts.push(slot.time);
        slotSelect.appendChild(createOption(slot.id, parts.join(' - ')));
      });

      slotSelect.disabled = false;
      submitBtn.disabled = false;
    } catch (error) {
      console.error(`Failed to load slots for project ${projectId}`, error);
      resetSlotSelect('Unable to load slots');
      setSlotNotice('We were unable to load slots for the selected project. Please try again.');
      submitBtn.disabled = true;
    }
  };

  projectSelect.addEventListener('change', (event) => {
    const projectId = event.target.value;
    loadSlotsForProject(projectId);
  });

  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSignupMessage('', null);

    const projectId = projectSelect.value;
    const slotId = slotSelect.value;
    const firstName = signupForm.firstName.value.trim();
    const lastName = signupForm.lastName.value.trim();
    const email = signupForm.email.value.trim();
    const phone = signupForm.phone.value.trim();

    if (!projectId || !slotId) {
      setSignupMessage('Please choose a project and slot before submitting.', 'error');
      return;
    }

    if (!firstName || !lastName || !email) {
      setSignupMessage('Please provide your first name, last name, and email address.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing Up...';

    try {
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/slots/${slotId}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 201) {
        setSignupMessage(data.message || 'Thank you for signing up! We will be in touch soon.', 'success');
        signupForm.reset();
        projectSelect.value = projectId;
        await loadSlotsForProject(projectId);
      } else if (response.status === 409) {
        setSignupMessage(data.error || 'That slot was just taken. Please choose another one.', 'error');
        await loadSlotsForProject(projectId);
      } else {
        setSignupMessage(data.error || data.message || 'We could not complete your signup. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Signup request failed', error);
      setSignupMessage('We hit a technical issue while submitting your signup. Please try again in a moment.', 'error');
    } finally {
      submitBtn.textContent = 'Sign Up';
      submitBtn.disabled = slotSelect.disabled;
    }
  });

  document.addEventListener('DOMContentLoaded', loadProjects);
})();
