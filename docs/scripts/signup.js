(() => {
  const DEFAULT_REMOTE_API = 'https://yafoc-serveboard.azurewebsites.net/api';
  const DEFAULT_LOCAL_API = 'http://localhost:7071/api';
  const configuredApiBase = window.serveboard?.apiBaseUrl;
  const apiBaseUrl = (configuredApiBase || (window.location.hostname === 'localhost' ? DEFAULT_LOCAL_API : DEFAULT_REMOTE_API)).replace(/\/$/, '');

  const slotsTableBody = document.getElementById('slotsTableBody');
  const slotsMsg = document.getElementById('slotsMsg');
  const slotsCardList = document.getElementById('slotsCardList');
  const selectedSlotSummary = document.getElementById('selectedSlotSummary');
  const signupForm = document.getElementById('signupForm');
  const signupMsg = document.getElementById('signupMsg');
  const submitBtn = document.getElementById('submitBtn');

  let openSlots = [];
  let selectedSlotId = null;
  let activeSlotRow = null;
  let activeSlotCard = null;

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

  const setSlotsMessage = (message, type) => {
    slotsMsg.textContent = message || '';
    slotsMsg.classList.remove('status-message--error', 'status-message--success');
    if (!message) return;
    if (type === 'error') {
      slotsMsg.classList.add('status-message--error');
    } else if (type === 'success') {
      slotsMsg.classList.add('status-message--success');
    }
  };

  const clearSelectedSlot = (message) => {
    selectedSlotId = null;
    if (activeSlotRow) {
      activeSlotRow.classList.remove('table-row--active');
      const priorButton = activeSlotRow.querySelector('button');
      if (priorButton) priorButton.textContent = 'Sign Up';
      activeSlotRow = null;
    }
    if (activeSlotCard) {
      activeSlotCard.classList.remove('table-card--active');
      const priorCardButton = activeSlotCard.querySelector('button');
      if (priorCardButton) priorCardButton.textContent = 'Sign Up';
      activeSlotCard = null;
    }
    selectedSlotSummary.textContent = message || 'Select an open slot above to continue.';
    if (message) {
      selectedSlotSummary.classList.remove('muted');
    } else {
      selectedSlotSummary.classList.add('muted');
    }
    submitBtn.disabled = true;
  };

  const applySelectedRowState = () => {
    if (activeSlotRow) {
      activeSlotRow.classList.remove('table-row--active');
      const priorButton = activeSlotRow.querySelector('button');
      if (priorButton) priorButton.textContent = 'Sign Up';
    }
    activeSlotRow = null;
    if (activeSlotCard) {
      activeSlotCard.classList.remove('table-card--active');
      const priorCardButton = activeSlotCard.querySelector('button');
      if (priorCardButton) priorCardButton.textContent = 'Sign Up';
    }
    activeSlotCard = null;
    if (!selectedSlotId) return;
    const currentRow = slotsTableBody.querySelector(`[data-slot-id="${selectedSlotId}"]`);
    if (currentRow) {
      currentRow.classList.add('table-row--active');
      const actionButton = currentRow.querySelector('button');
      if (actionButton) actionButton.textContent = 'Selected';
      activeSlotRow = currentRow;
    }
    const currentCard = slotsCardList.querySelector(`[data-slot-id="${selectedSlotId}"]`);
    if (currentCard) {
      currentCard.classList.add('table-card--active');
      const actionButton = currentCard.querySelector('button');
      if (actionButton) actionButton.textContent = 'Selected';
      activeSlotCard = currentCard;
    }
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

  const showSlotsListMessage = (message) => {
    slotsTableBody.innerHTML = '';
    const row = document.createElement('tr');
    row.className = 'table-message';
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = message;
    row.appendChild(cell);
    slotsTableBody.appendChild(row);

    slotsCardList.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'table-card table-card--message';
    card.textContent = message;
    slotsCardList.appendChild(card);
  };

  const toDisplayTime = (time) => {
    if (!time) return 'Time TBD';
    const [hourStr, minuteStr = '00'] = time.split(':');
    const hour = parseInt(hourStr, 10);
    if (!Number.isFinite(hour)) return time;
    const minutes = minuteStr.padStart(2, '0');
    const isPm = hour >= 12;
    const displayHour = ((hour + 11) % 12) + 1;
    return `${displayHour}:${minutes} ${isPm ? 'PM' : 'AM'}`;
  };

  const normalizeSlotMetrics = (slot) => {
    const rawCapacity = parseInt(slot.capacity, 10);
    const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
    const rawFilled = parseInt(slot.filledCount, 10);
    const fallbackFilled = slot.volunteer ? 1 : 0;
    const filledCount = Math.max(0, Number.isFinite(rawFilled) ? rawFilled : fallbackFilled);
    const spotsRemaining = Math.max(0, capacity - filledCount);
    return { capacity, filledCount, spotsRemaining };
  };

  const renderSlotsTable = (slots) => {
    slotsTableBody.innerHTML = '';
    slotsCardList.innerHTML = '';

    if (!Array.isArray(slots) || slots.length === 0) {
      showSlotsListMessage('No volunteer openings are available right now.');
      return;
    }

    const addCardField = (card, label, value, secondary) => {
      const field = document.createElement('div');
      field.className = 'table-card__field';
      const labelEl = document.createElement('span');
      labelEl.className = 'table-card__label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'table-card__value';
      valueEl.textContent = value;
      field.append(labelEl, valueEl);
      if (secondary) {
        const secondaryEl = document.createElement('span');
        secondaryEl.className = 'table-card__muted';
        secondaryEl.textContent = secondary;
        field.appendChild(secondaryEl);
      }
      card.appendChild(field);
    };

    slots.forEach((slot) => {
      const row = document.createElement('tr');
      row.dataset.slotId = slot.id;
      const volunteerText = `${slot.filledCount}/${slot.capacity} filled`;
      const spotsText = `${slot.spotsRemaining} open`;

      row.innerHTML = `
        <td>
          <div>${slot.projectTitle}</div>
          <div class="muted">${slot.projectCategory || 'General'}</div>
        </td>
        <td>${slot.task || 'Volunteer slot'}</td>
        <td>
          <div>${slot.date || 'Date TBD'}</div>
          <div class="muted">${toDisplayTime(slot.time)}</div>
        </td>
        <td>
          <div>${spotsText}</div>
          <div class="muted">${volunteerText}</div>
        </td>
        <td></td>
      `;

      const actionCell = row.querySelector('td:last-child');
      actionCell.classList.add('table-actions');
      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'btn btn-secondary btn-inline';
      selectBtn.textContent = 'Sign Up';
      const handleSelect = () => selectSlot(slot.id);
      selectBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        handleSelect();
      });
      row.addEventListener('click', handleSelect);
      actionCell.appendChild(selectBtn);

      slotsTableBody.appendChild(row);

      const card = document.createElement('article');
      card.className = 'table-card';
      card.dataset.slotId = slot.id;
      addCardField(card, 'Project', slot.projectTitle, slot.projectCategory || 'General');
      addCardField(card, 'Opportunity', slot.task || 'Volunteer slot');
      addCardField(card, 'Schedule', slot.date || 'Date TBD', toDisplayTime(slot.time));
      addCardField(card, 'Spots', spotsText, volunteerText);

      const cardActions = document.createElement('div');
      cardActions.className = 'table-card__actions';
      const cardButton = document.createElement('button');
      cardButton.type = 'button';
      cardButton.className = 'btn btn-secondary btn-inline';
      cardButton.textContent = 'Sign Up';
      cardButton.addEventListener('click', (event) => {
        event.stopPropagation();
        handleSelect();
      });
      card.addEventListener('click', handleSelect);
      cardActions.appendChild(cardButton);
      card.appendChild(cardActions);
      slotsCardList.appendChild(card);
    });

    applySelectedRowState();
  };

  const selectSlot = (slotId) => {
    if (selectedSlotId === slotId) {
      // If the same slot is clicked again, deselect it
      clearSelectedSlot();
      return;
    }

    const slot = openSlots.find((entry) => entry.id === slotId);
    if (!slot) return;

    selectedSlotId = slotId;
    const summaryParts = [];
    summaryParts.push(slot.projectCategory ? `${slot.projectTitle} (${slot.projectCategory})` : slot.projectTitle);
    if (slot.task) summaryParts.push(slot.task);
    if (slot.date) summaryParts.push(slot.date);
    if (slot.time) summaryParts.push(toDisplayTime(slot.time));
    summaryParts.push(`${slot.spotsRemaining} spot${slot.spotsRemaining === 1 ? '' : 's'} left`);

    selectedSlotSummary.textContent = summaryParts.join(' | ');
    selectedSlotSummary.classList.remove('muted');
    submitBtn.disabled = false;
    setSignupMessage('', null);
    applySelectedRowState();
  };

  const loadOpenSlots = async () => {
    showSlotsListMessage('Loading open slots...');
    setSlotsMessage('', null);

    try {
      const projects = await fetchJson(`${apiBaseUrl}/projects`);
      const projectList = Array.isArray(projects) ? projects : [];

      const combinedSlots = [];
      for (const project of projectList) {
        try {
          const slotResponse = await fetchJson(`${apiBaseUrl}/projects/${project.id}/slots`);
          const slotList = Array.isArray(slotResponse) ? slotResponse : [];
          slotList.forEach((slot) => {
            const status = (slot.status || '').toLowerCase();
            const metrics = normalizeSlotMetrics(slot);
            if (status !== 'available') return;
            if (metrics.spotsRemaining <= 0) return;
            combinedSlots.push({
              id: slot.id,
              projectId: project.id,
              projectTitle: project.title || 'Project',
              projectCategory: project.category || 'General',
              task: slot.task,
              date: slot.date,
              time: slot.time,
              capacity: metrics.capacity,
              filledCount: metrics.filledCount,
              spotsRemaining: metrics.spotsRemaining,
              status
            });
          });
        } catch (slotError) {
          console.error(`Failed to load slots for project ${project.id}`, slotError);
        }
      }

      combinedSlots.sort((a, b) => {
        const projectCompare = (a.projectTitle || '').localeCompare(b.projectTitle || '', undefined, { sensitivity: 'base' });
        if (projectCompare !== 0) return projectCompare;
        const dateCompare = (a.date || '').localeCompare(b.date || '');
        if (dateCompare !== 0) return dateCompare;
        return (a.time || '').localeCompare(b.time || '');
      });

      openSlots = combinedSlots;
      renderSlotsTable(openSlots);

      if (openSlots.length === 0) {
        clearSelectedSlot();
        setSlotsMessage('All volunteer opportunities are currently filled. Please check back soon.', null);
      } else if (selectedSlotId) {
        const stillOpen = openSlots.some((slot) => slot.id === selectedSlotId);
        if (!stillOpen) {
          clearSelectedSlot('That slot was just filled. Please pick another opportunity.');
          setSignupMessage('The slot you selected is no longer available. Please choose another opening.', 'error');
        } else {
          applySelectedRowState();
        }
      } else {
        clearSelectedSlot();
      }
    } catch (error) {
      console.error('Failed to load volunteer opportunities', error);
      openSlots = [];
      renderSlotsTable(openSlots);
      clearSelectedSlot('We could not load open slots. Please try again later.');
      setSlotsMessage('Unable to load volunteer opportunities. Please try again later.', 'error');
    }
  };

  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setSignupMessage('', null);

    if (!selectedSlotId) {
      setSignupMessage('Select an open slot before submitting your information.', 'error');
      return;
    }

    const slot = openSlots.find((entry) => entry.id === selectedSlotId);
    if (!slot) {
      setSignupMessage('The selected slot is no longer available. Please choose another opening.', 'error');
      await loadOpenSlots();
      return;
    }

    const firstName = signupForm.firstName.value.trim();
    const lastName = signupForm.lastName.value.trim();
    const email = signupForm.email.value.trim();
    const phone = signupForm.phone.value.trim();

    if (!firstName || !lastName || !email) {
      setSignupMessage('Please provide your first name, last name, and email address.', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing Up...';

    try {
      const response = await fetch(`${apiBaseUrl}/projects/${slot.projectId}/slots/${slot.id}/signup`, {
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
        clearSelectedSlot();
        await loadOpenSlots();
      } else if (response.status === 409) {
        setSignupMessage(data.error || 'That slot was just taken. Please choose another one.', 'error');
        clearSelectedSlot('That slot was just filled. Please pick another opportunity.');
        await loadOpenSlots();
      } else {
        setSignupMessage(data.error || data.message || 'We could not complete your signup. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Signup request failed', error);
      setSignupMessage('We hit a technical issue while submitting your signup. Please try again in a moment.', 'error');
    } finally {
      submitBtn.textContent = 'Sign Up';
      submitBtn.disabled = !selectedSlotId;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    clearSelectedSlot();
    loadOpenSlots();
  });
})();
