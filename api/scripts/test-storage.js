const { TableClient } = require("@azure/data-tables");

(async () => {
  try {
    const connectionString = process.argv[2];
    if (!connectionString) {
      throw new Error("Missing connection string argument");
    }
    const tableName = process.argv[3] || "Projects";
    const client = TableClient.fromConnectionString(connectionString, tableName);

    console.log(`Ensuring table '${tableName}' exists...`);
    try {
      await client.createTable();
      console.log("Table created");
    } catch (err) {
      if (err.statusCode === 409) {
        console.log("Table already exists");
      } else {
        throw err;
      }
    }

    console.log("Listing up to 5 entities:");
    let count = 0;
    for await (const entity of client.listEntities({ maxPerPage: 5 })) {
      count += 1;
      console.log(entity);
      if (count >= 5) break;
    }
    if (count === 0) {
      console.log("No entities found");
    }
  } catch (err) {
    console.error("Storage test failed:", err);
    process.exitCode = 1;
  }
})();
