const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
    // Extract project ID from route
    const projectId = context.bindingData.id;
    context.log(`GET /api/projects/${projectId}/slots called`);

    const connectionString = process.env["AzureWebJobsStorage"];
    const tableName = "Slots";
    const client = TableClient.fromConnectionString(connectionString, tableName);

    let slots = [];
    try {
        // Query all slots for this project (PartitionKey = projectId)
        const entities = client.listEntities({ queryOptions: { filter: `PartitionKey eq '${projectId}'` } });
        for await (const entity of entities) {
            const rawCapacity = parseInt(entity.Capacity ?? entity.capacity ?? 1, 10);
            const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
            const inferredFilled = entity.VolunteerEmail ? 1 : 0;
            const rawFilledCount = parseInt(entity.FilledCount ?? entity.filledCount ?? inferredFilled, 10);
            const filledCount = Math.max(0, Number.isFinite(rawFilledCount) ? rawFilledCount : 0);
            const spotsRemaining = Math.max(0, capacity - filledCount);
            let slot = {
                id: entity.rowKey || entity.RowKey,
                task: entity.Task,
                status: entity.Status,
                date: entity.Date,
                time: entity.Time,
                capacity,
                filledCount,
                spotsRemaining,
                volunteer: entity.VolunteerEmail ? {
                    email: entity.VolunteerEmail,
                    firstName: entity.VolunteerFirstName,
                    lastName: entity.VolunteerLastName,
                    phone: entity.VolunteerPhone
                } : null
            };
            slots.push(slot);
        }
    } catch (err) {
        context.log.error("Error querying Table Storage:", err);
        context.res = {
            status: 500,
            body: { error: "Failed to load slots." }
        };
        return;
    }

    context.res = {
        status: 200,
        headers: {
            "Content-Type": "application/json"
        },
        body: slots
    };
};
