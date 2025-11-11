const { TableClient } = require("@azure/data-tables");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

async function validateMicrosoftToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const decoded = jwt.decode(token, { complete: true }) || {};
  const tokenHeader = decoded.header || {};
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!tenantId || !clientId) {
    throw new Error("Missing Microsoft identity configuration. Ensure MICROSOFT_TENANT_ID and MICROSOFT_CLIENT_ID are set.");
  }
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const audiences = [clientId, `api://${clientId}`];
  const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  const client = jwksClient({ jwksUri, cache: true, rateLimit: true, jwksRequestsPerMinute: 5 });

  function getKey(header, callback) {
    const keyId = header.kid || header.x5t;
    if (!keyId) {
      return callback(new Error("Missing key identifier in token header"));
    }
    client.getSigningKey(keyId, (err, key) => {
      if (err) return callback(err);
      callback(null, key.getPublicKey());
    });
  }

  return new Promise(resolve => {
    jwt.verify(token, getKey, {
      audience: audiences,
      issuer,
      algorithms: ["RS256"]
    }, (err, decodedToken) => {
      if (err) {
        console.warn("Microsoft token validation failed (create-project)", {
          message: err.message,
          code: err.code,
          name: err.name,
          kid: tokenHeader.kid,
          x5t: tokenHeader.x5t
        });
        return resolve(null);
      }
      console.log("Microsoft token validated (create-project)", {
        audience: decodedToken.aud,
        issuer: decodedToken.iss,
        subject: decodedToken.sub
      });
      resolve(decodedToken);
    });
  });
}

module.exports = async function (context, req) {
  // Require Microsoft auth for project creation
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
    context.log("Creating project with entity:", JSON.stringify(entity));
    context.log("Using table:", "Projects");
    context.log("Storage connection string present:", !!connectionString);
    
    await tableClient.createEntity(entity);
    
    context.log("Project created successfully");
    context.res = {
      status: 201,
      body: { message: "Project created successfully!", projectId, category: partitionKey }
    };
  } catch (error) {
    context.log("Error creating project. Full error:", error);
    context.log("Error message:", error.message);
    context.log("Error details:", error.details || "No details available");
    context.res = { 
      status: 500, 
      body: { 
        error: "Failed to create project.", 
        details: error.message 
      } 
    };
  }
};
