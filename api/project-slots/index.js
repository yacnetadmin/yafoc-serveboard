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
            let slot = {
                id: entity.rowKey || entity.RowKey,
                task: entity.Task,
                status: entity.Status,
                date: entity.Date,
                time: entity.Time,
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
