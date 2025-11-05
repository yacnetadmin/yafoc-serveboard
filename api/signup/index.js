const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  const { id, slotId } = context.bindingData;
  const { volunteerName, volunteerEmail } = req.body;

  if (!volunteerName || !volunteerEmail) {
    context.res = { status: 400, body: { error: "Missing volunteer info." } };
    return;
  }

  const connectionString = process.env.AzureWebJobsStorage;
  const tableClient = TableClient.fromConnectionString(connectionString, "Slots");

  try {
    // Get the slot entity
    const slot = await tableClient.getEntity(id, slotId);

    if (slot.Status === "filled") {
      context.res = { status: 409, body: { error: "This slot is already taken." } };
      return;
    }

    // Update slot
    slot.VolunteerName = volunteerName;
    slot.VolunteerEmail = volunteerEmail;
    slot.Status = "filled";

    await tableClient.updateEntity(slot, "Replace");

    context.res = { status: 200, body: { message: "Slot signed up successfully!" } };
  } catch (error) {
    context.log("Error signing up:", error);
    context.res = { status: 500, body: { error: "Failed to sign up for slot." } };
  }
};
