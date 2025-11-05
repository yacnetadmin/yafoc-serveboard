// api/projects/index.js
const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
    context.log("GET /api/projects called");

    // Use connection string from environment variable (set in local.settings.json or Azure)
    const connectionString = process.env["AzureWebJobsStorage"];
    const tableName = "Projects";
    const client = TableClient.fromConnectionString(connectionString, tableName);

    let projects = [];
    try {
        // Query all entities in the Projects table
        const entities = client.listEntities();
        for await (const entity of entities) {
            // Each entity is a project; tasks can be stored as JSON string or in a separate table
            let project = {
                id: entity.rowKey || entity.RowKey, // Project ID
                category: entity.partitionKey || entity.PartitionKey, // Project group/category
                title: entity.Title,
                description: entity.Description,
                contact: {
                    email: entity.ContactEmail,
                    firstName: entity.ContactFirstName,
                    lastName: entity.ContactLastName,
                    phone: entity.ContactPhone
                }
            };
            projects.push(project);
        }
    } catch (err) {
        context.log.error("Error querying Table Storage:", err);
        context.res = {
            status: 500,
            body: { error: "Failed to load projects." }
        };
        return;
    }

    context.res = {
        status: 200,
        headers: {
            "Content-Type": "application/json"
        },
        body: projects
    };
};
