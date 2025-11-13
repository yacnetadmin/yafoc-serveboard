const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  const projectId = context.bindingData.id;
  const slotId = context.bindingData.slotId;
  const { firstName, lastName, email, phone } = req.body || {};

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true"
  };

  if (req.method === "OPTIONS") {
    context.res = {
      status: 200,
      headers: corsHeaders
    };
    return;
  }

  if (!firstName || !lastName || !email) {
    context.res = { status: 400, headers: corsHeaders, body: { error: "Missing volunteer name or email." } };
    return;
  }

  const connectionString = process.env["AzureWebJobsStorage"] || process.env["TableStorageConnectionString"];
  if (!connectionString) {
    context.log.error("No storage connection string configured for signup");
    context.res = { status: 500, headers: corsHeaders, body: { error: "Storage configuration missing." } };
    return;
  }

  const slotsClient = TableClient.fromConnectionString(connectionString, "Slots");
  const volunteersClient = TableClient.fromConnectionString(connectionString, "SlotVolunteers");

  try {
    await volunteersClient.createTable();
  } catch (creationError) {
    if (creationError.statusCode !== 409) {
      context.log.error("Failed to ensure SlotVolunteers table exists", creationError);
      context.res = { status: 500, headers: corsHeaders, body: { error: "Unable to record volunteer signups." } };
      return;
    }
  }

  let slotUpdateCompleted = false;
  let currentStatus = "available";

  try {
    const slot = await slotsClient.getEntity(projectId, slotId);

    const rawCapacity = parseInt(slot.Capacity ?? slot.capacity ?? 1, 10);
    const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
    const rawFilled = parseInt(slot.FilledCount ?? slot.filledCount ?? (slot.VolunteerEmail ? 1 : 0), 10);
    const filledCount = Math.max(0, Number.isFinite(rawFilled) ? rawFilled : 0);
    currentStatus = (slot.Status || "").toLowerCase();

    if (filledCount >= capacity) {
      context.res = { status: 409, headers: corsHeaders, body: { error: "This slot is already full." } };
      return;
    }

    const nextStatus = currentStatus === "held"
      ? "held"
      : (filledCount + 1 >= capacity ? "filled" : "available");

    const updated = {
      partitionKey: projectId,
      rowKey: slotId,
      PartitionKey: projectId,
      RowKey: slotId,
      FilledCount: filledCount + 1,
      VolunteerFirstName: "",
      VolunteerLastName: "",
      VolunteerEmail: "",
      VolunteerPhone: "",
      Status: nextStatus,
      LastVolunteerSignupUtc: new Date().toISOString()
    };

    const options = slot.etag ? { etag: slot.etag } : { etag: "*" };
    await slotsClient.updateEntity(updated, "Merge", options);
    slotUpdateCompleted = true;

    const volunteerPartition = `${projectId}|${slotId}`;
    const volunteerEntity = {
      PartitionKey: volunteerPartition,
      RowKey: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      ProjectId: projectId,
      SlotId: slotId,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Phone: phone || "",
      SignedUpUtc: new Date().toISOString()
    };

    await volunteersClient.createEntity(volunteerEntity);

    context.res = {
      status: 201,
      headers: corsHeaders,
      body: {
        message: "Slot signed up successfully!",
        slot: {
          id: slotId,
          task: slot.Task,
          date: slot.Date,
          time: slot.Time,
          status: nextStatus,
          capacity,
          filledCount: filledCount + 1,
          spotsRemaining: Math.max(0, capacity - (filledCount + 1)),
          volunteer: {
            email,
            firstName,
            lastName,
            phone: phone || ""
          }
        }
      }
    };
  } catch (error) {
    context.log("Error signing up:", error);

    if (slotUpdateCompleted) {
      try {
        const slot = await slotsClient.getEntity(projectId, slotId);
        const rawFilled = parseInt(slot.FilledCount ?? slot.filledCount ?? 1, 10);
        const safeFilled = Math.max(0, Number.isFinite(rawFilled) ? rawFilled - 1 : 0);
        const rawCapacity = parseInt(slot.Capacity ?? slot.capacity ?? 1, 10);
        const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
        const rollbackStatus = safeFilled >= capacity
          ? "filled"
          : (currentStatus === "held" ? "held" : "available");
        await slotsClient.updateEntity({
          partitionKey: projectId,
          rowKey: slotId,
          PartitionKey: projectId,
          RowKey: slotId,
          FilledCount: safeFilled,
          Status: rollbackStatus
        }, "Merge", slot.etag ? { etag: slot.etag } : { etag: "*" });
      } catch (rollbackError) {
        context.log.error("Failed to roll back filled count after signup error", rollbackError);
      }
    }
    if (error.statusCode === 404) {
      context.res = { status: 404, headers: corsHeaders, body: { error: "Slot not found." } };
      return;
    }
    if (error.statusCode === 412) {
      context.res = { status: 409, headers: corsHeaders, body: { error: "Sorry, that slot was just taken. Please choose another." } };
      return;
    }
    context.res = { status: 500, headers: corsHeaders, body: { error: "Failed to sign up for slot." } };
  }
};
