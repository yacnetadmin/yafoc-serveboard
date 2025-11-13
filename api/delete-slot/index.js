const { TableClient } = require("@azure/data-tables");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

async function validateMicrosoftToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.substring(7);
  const decoded = jwt.decode(token, { complete: true }) || {};
  const tokenHeader = decoded.header || {};
  const payload = decoded.payload || {};
  const configuredTenantId = (process.env.MICROSOFT_TENANT_ID || "").trim();
  const clientId = (process.env.MICROSOFT_CLIENT_ID || "").trim();
  if (!clientId) {
    throw new Error("Missing Microsoft identity configuration. Ensure MICROSOFT_CLIENT_ID is set.");
  }

  const tokenTenantId = (payload.tid || payload.tenantId || "").trim();
  const effectiveTenantId = tokenTenantId || configuredTenantId;
  if (!effectiveTenantId) {
    throw new Error("Unable to determine tenant from configuration or token.");
  }
  if (configuredTenantId && tokenTenantId && configuredTenantId !== tokenTenantId) {
    console.warn("Token tenant does not match configured tenant (delete-slot)", { configuredTenantId, tokenTenantId });
  }

  const issuer = payload.iss || `https://login.microsoftonline.com/${effectiveTenantId}/v2.0`;
  const jwksUri = `https://login.microsoftonline.com/${effectiveTenantId}/discovery/v2.0/keys`;
  const audiences = Array.from(new Set([
    clientId,
    `api://${clientId}`,
    `api://${clientId}/.default`,
    `api://${clientId}/user_impersonation`,
    payload.aud
  ].filter(Boolean)));
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
        console.warn("Microsoft token validation failed (delete-slot)", {
          message: err.message,
          code: err.code,
          name: err.name,
          kid: tokenHeader.kid,
          x5t: tokenHeader.x5t,
          audience: payload.aud,
          issuer: payload.iss,
          tenant: tokenTenantId,
          jwksUri
        });
        return resolve(null);
      }
      console.log("Microsoft token validated (delete-slot)", {
        audience: decodedToken.aud,
        issuer: decodedToken.iss,
        subject: decodedToken.sub
      });
      resolve(decodedToken);
    });
  });
}

module.exports = async function (context, req) {
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
    context.res = {
      status: 401,
      body: { error: "Unauthorized. Please sign in with Microsoft." }
    };
    return;
  }

  const projectId = context.bindingData.id;
  const slotId = context.bindingData.slotId;
  if (!projectId || !slotId) {
    context.res = {
      status: 400,
      body: { error: "Missing project or slot identifier." }
    };
    return;
  }

  const connectionString = process.env["AzureWebJobsStorage"] || process.env["TableStorageConnectionString"];
  if (!connectionString) {
    context.log.error("No storage connection string configured for slot deletion");
    context.res = {
      status: 500,
      body: { error: "Storage configuration missing." }
    };
    return;
  }

  const client = TableClient.fromConnectionString(connectionString, "Slots");

  try {
    await client.getEntity(projectId, slotId);
  } catch (err) {
    if (err.statusCode === 404) {
      context.res = {
        status: 404,
        body: { error: "Slot not found." }
      };
      return;
    }
    context.log.error("Error retrieving slot before deletion", err);
    context.res = {
      status: 500,
      body: { error: "Failed to load slot for deletion." }
    };
    return;
  }

  try {
    await client.deleteEntity(projectId, slotId);
    context.res = { status: 204 };
  } catch (err) {
    context.log.error("Error deleting slot", err);
    context.res = {
      status: 500,
      body: { error: "Failed to delete slot." }
    };
  }
};
