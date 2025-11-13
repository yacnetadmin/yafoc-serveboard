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

  const volunteerPartition = `${projectId}|${slotId}`;

  const parseSlotMetrics = (entity) => {
    const rawCapacity = parseInt(entity.Capacity ?? entity.capacity ?? 1, 10);
    const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
    const rawFilled = parseInt(entity.FilledCount ?? entity.filledCount ?? (entity.VolunteerEmail ? 1 : 0), 10);
    const filled = Math.max(0, Number.isFinite(rawFilled) ? rawFilled : 0);
    return { capacity, filled };
  };

  const countVolunteers = async () => {
    let count = 0;
    const iter = volunteersClient.listEntities({ queryOptions: { filter: `PartitionKey eq '${volunteerPartition}'` } });
    for await (const entity of iter) {
      count += 1;
    }
    return count;
  };

  let volunteerRowKey = null;

  try {
    const slot = await slotsClient.getEntity(projectId, slotId);
    const { capacity } = parseSlotMetrics(slot);
    const currentStatus = (slot.Status || "").toLowerCase();
    const existingVolunteerCount = await countVolunteers();

    if (existingVolunteerCount >= capacity) {
      context.res = { status: 409, headers: corsHeaders, body: { error: "This slot is already full." } };
      return;
    }

    volunteerRowKey = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const volunteerEntity = {
      PartitionKey: volunteerPartition,
      RowKey: volunteerRowKey,
      ProjectId: projectId,
      SlotId: slotId,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Phone: phone || "",
      SignedUpUtc: new Date().toISOString()
    };

    await volunteersClient.createEntity(volunteerEntity);

    const finalFilledCount = existingVolunteerCount + 1;
    const nextStatus = currentStatus === "held"
      ? "held"
      : (finalFilledCount >= capacity ? "filled" : "available");

    try {
      await slotsClient.updateEntity({
        partitionKey: projectId,
        rowKey: slotId,
        PartitionKey: projectId,
        RowKey: slotId,
        FilledCount: finalFilledCount,
        filledCount: finalFilledCount,
        Status: nextStatus,
        LastVolunteerSignupUtc: new Date().toISOString()
      }, "Merge", slot.etag ? { ifMatch: slot.etag } : undefined);
    } catch (updateError) {
      context.log.warn("Slot update failed after volunteer signup, rolling back volunteer entity", {
        statusCode: updateError.statusCode,
        message: updateError.message
      });
      try {
        await volunteersClient.deleteEntity(volunteerPartition, volunteerRowKey);
      } catch (rollbackError) {
        context.log.error("Failed to remove volunteer entity during rollback", rollbackError);
      }
      if (updateError.statusCode === 412 || updateError.statusCode === 409) {
        context.res = { status: 409, headers: corsHeaders, body: { error: "Sorry, that slot was just taken. Please choose another." } };
        return;
      }
      throw updateError;
    }

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
          filledCount: finalFilledCount,
          spotsRemaining: Math.max(0, capacity - finalFilledCount),
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
    context.log.error("Error signing up:", error);
    if (error.statusCode === 404) {
      context.res = { status: 404, headers: corsHeaders, body: { error: "Slot not found." } };
      return;
    }
    if (error.statusCode === 409 || error.statusCode === 412) {
      context.res = { status: 409, headers: corsHeaders, body: { error: "Sorry, that slot was just taken. Please choose another." } };
      return;
    }
    context.res = { status: 500, headers: corsHeaders, body: { error: "Failed to sign up for slot." } };
  }
};
