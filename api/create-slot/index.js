const { TableClient } = require("@azure/data-tables");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

async function validateMicrosoftToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!tenantId || !clientId) {
    throw new Error("Missing Microsoft identity configuration. Ensure MICROSOFT_TENANT_ID and MICROSOFT_CLIENT_ID are set.");
  }
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const audiences = [clientId, `api://${clientId}`];
  const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  const client = jwksClient({ jwksUri });
  function getKey(header, callback) {
    client.getSigningKey(header.kid, function(err, key) {
      if (err) return callback(err);
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  }
  try {
    return await new Promise((resolve, reject) => {
      jwt.verify(token, getKey, {
        audience: audiences,
        issuer,
        algorithms: ["RS256"]
      }, (err, decoded) => {
        if (err) return resolve(null);
        resolve(decoded);
      });
    });
  } catch (e) {
    return null;
  }
}

module.exports = async function (context, req) {
  // Require Microsoft auth for slot creation
  let user;
  try {
    user = await validateMicrosoftToken(req.headers["authorization"]);
  } catch (configError) {
    context.log.error("Configuration error while validating Microsoft token:", configError);
    context.res = {
      status: 500,
      body: { error: "Server configuration error. Please contact an administrator." }
    };
    return;
  }
  if (!user) {
    context.res = { status: 401, body: { error: "Unauthorized. Please sign in with Microsoft." } };
    return;
  }

  const { id } = context.bindingData; // project ID
  const { task, date, time } = req.body;

  if (!task || !date || !time) {
    context.res = { status: 400, body: { error: "Missing required slot info." } };
    return;
  }

  const connectionString = process.env.AzureWebJobsStorage;
  const tableClient = TableClient.fromConnectionString(connectionString, "Slots");

  // Generate a unique slot ID
  const slotId = uuidv4();
  const partitionKey = id;
  const rowKey = slotId;

  const entity = {
    PartitionKey: partitionKey,
    RowKey: rowKey,
    Task: task,
    Date: date,
    Time: time,
    Status: "available"
  };

  try {
    await tableClient.createEntity(entity);
    context.res = {
      status: 201,
      body: { message: "Slot created successfully!", slotId }
    };
  } catch (error) {
    context.log("Error creating slot:", error);
    context.res = { status: 500, body: { error: "Failed to create slot." } };
  }
};
