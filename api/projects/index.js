// api/projects/index.js
const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
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
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true"
        },
        body: projects
    };
  } catch (err) {
    context.log.error("UNCAUGHT ERROR in projects function:", err);
    context.res = { 
      status: 500, 
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true"
      },
      body: { 
        error: "Internal server error", 
        details: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      } 
    };
  }
};
