// api/projects/index.js
const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    context.log("GET /api/projects called");

    // Use connection string from environment variable (set in local.settings.json or Azure)
    const connectionString = process.env["AzureWebJobsStorage"] || process.env["TableStorageConnectionString"];
    if (!connectionString) {
      throw new Error("No storage connection string found in AzureWebJobsStorage or TableStorageConnectionString");
    }
    context.log("Using table storage connection string from", process.env["AzureWebJobsStorage"] ? "AzureWebJobsStorage" : "TableStorageConnectionString");
    
    const tableName = "Projects";
    context.log("Creating table client for table:", tableName);
    const client = TableClient.fromConnectionString(connectionString, tableName);
    
    // Try to create table if it doesn't exist
    try {
      context.log("Creating table if it doesn't exist");
      await client.createTable();
      context.log("Table creation successful or table already exists");
    } catch (err) {
      context.log.error("Error creating table:", err);
      if (err.statusCode !== 409) { // 409 means table already exists, which is fine
        throw new Error(`Failed to ensure table exists: ${err.message}`);
      }
      context.log("Table already exists, continuing...");
    }
    
    // Validate table exists by attempting to query it
    try {
      const testQuery = client.listEntities({ maxPerPage: 1 });
      await testQuery.next();
      context.log("Table connection validated successfully");
    } catch (err) {
      context.log.error("Failed to validate table connection:", err);
      throw new Error(`Table connection validation failed: ${err.message}`);
    }

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
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Allow-Credentials": "true"
            },
            body: { 
                error: "Failed to load projects",
                details: err.message,
                code: err.code,
                statusCode: err.statusCode
            }
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
