const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  const projectId = context.bindingData.id;
  const slotId = context.bindingData.slotId;
  const { firstName, lastName, email, phone } = req.body || {};

  if (!firstName || !lastName || !email) {
    context.res = { status: 400, body: { error: "Missing volunteer name or email." } };
    return;
  }

  const connectionString = process.env["AzureWebJobsStorage"] || process.env["TableStorageConnectionString"];
  if (!connectionString) {
    context.log.error("No storage connection string configured for signup");
    context.res = { status: 500, body: { error: "Storage configuration missing." } };
    return;
  }

  const tableClient = TableClient.fromConnectionString(connectionString, "Slots");

  try {
    const slot = await tableClient.getEntity(projectId, slotId);

    const status = (slot.Status || "").toLowerCase();
    if (status === "filled" || status === "reserved") {
      context.res = { status: 409, body: { error: "This slot is already taken." } };
      return;
    }

    const updated = {
      partitionKey: projectId,
      rowKey: slotId,
      PartitionKey: projectId,
      RowKey: slotId,
      VolunteerFirstName: firstName,
      VolunteerLastName: lastName,
      VolunteerEmail: email,
      VolunteerPhone: phone || "",
      Status: "reserved",
      VolunteerSignedUpUtc: new Date().toISOString()
    };

    const options = slot.etag ? { etag: slot.etag } : { etag: "*" };
    await tableClient.updateEntity(updated, "Merge", options);

    context.res = {
      status: 201,
      body: {
        message: "Slot signed up successfully!",
        slot: {
          id: slotId,
          task: slot.Task,
          date: slot.Date,
          time: slot.Time,
          status: "reserved",
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
    if (error.statusCode === 404) {
      context.res = { status: 404, body: { error: "Slot not found." } };
      return;
    }
    context.res = { status: 500, body: { error: "Failed to sign up for slot." } };
  }
};
