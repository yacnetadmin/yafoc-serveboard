const { TableClient } = require("@azure/data-tables");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");
const jwksClient = require("jwks-rsa");

async function validateMicrosoftToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const tenantId = process.env.MICROSOFT_TENANT_ID || require("../../frontend/config/microsoft.json").tenantId;
  const clientId = process.env.MICROSOFT_CLIENT_ID || require("../../frontend/config/microsoft.json").clientId;
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
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
        audience: clientId,
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
  // Require Microsoft auth for project creation
  const user = await validateMicrosoftToken(req.headers["authorization"]);
  if (!user) {
    context.res = { status: 401, body: { error: "Unauthorized. Please sign in with Microsoft." } };
    return;
  }

  const {
    title,
    description,
    contactEmail,
    contactFirstName,
    contactLastName,
    contactPhone,
    category
  } = req.body;

  if (!title || !description || !contactEmail) {
    context.res = { status: 400, body: { error: "Missing required project info." } };
    return;
  }

  const connectionString = process.env.AzureWebJobsStorage;
  const tableClient = TableClient.fromConnectionString(connectionString, "Projects");

  // Generate a unique project ID
  const projectId = uuidv4();
  const partitionKey = category || "General";
  const rowKey = projectId;

  const entity = {
    PartitionKey: partitionKey,
    RowKey: rowKey,
    Title: title,
    Description: description,
    ContactEmail: contactEmail,
    ContactFirstName: contactFirstName || "",
    ContactLastName: contactLastName || "",
    ContactPhone: contactPhone || ""
  };

  try {
    await tableClient.createEntity(entity);
    context.res = {
      status: 201,
      body: { message: "Project created successfully!", projectId, category: partitionKey }
    };
  } catch (error) {
    context.log("Error creating project:", error);
    context.res = { status: 500, body: { error: "Failed to create project." } };
  }
};
