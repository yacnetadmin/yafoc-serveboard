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
    console.warn("Token tenant does not match configured tenant (slot volunteers)", { configuredTenantId, tokenTenantId });
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
        console.warn("Microsoft token validation failed (slot volunteers)", {
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
      console.log("Microsoft token validated (slot volunteers)", {
        audience: decodedToken.aud,
        issuer: decodedToken.iss,
        subject: decodedToken.sub
      });
      resolve(decodedToken);
    });
  });
}

module.exports = async function (context, req) {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true"
  };

  if (req.method === "OPTIONS") {
    context.res = {
      status: 200,
      headers: corsHeaders
    };
    return;
  }

  let user;
  try {
    user = await validateMicrosoftToken(req.headers["authorization"]);
  } catch (configError) {
    context.log.error("Configuration error while validating Microsoft token (slot volunteers)", configError);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: "Server configuration error. Please contact an administrator." }
    };
    return;
  }

  if (!user) {
    context.res = {
      status: 401,
      headers: corsHeaders,
      body: { error: "Unauthorized. Please sign in with Microsoft." }
    };
    return;
  }

  const projectId = context.bindingData.id;
  const slotId = context.bindingData.slotId;

  const connectionString = process.env["AzureWebJobsStorage"] || process.env["TableStorageConnectionString"];
  if (!connectionString) {
    context.log.error("No storage connection string configured for slot volunteers");
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: "Storage configuration missing." }
    };
    return;
  }

  const volunteersClient = TableClient.fromConnectionString(connectionString, "SlotVolunteers");

  try {
    await volunteersClient.createTable();
  } catch (creationError) {
    if (creationError.statusCode !== 409) {
      context.log.error("Failed to ensure SlotVolunteers table exists", creationError);
      context.res = {
        status: 500,
        headers: corsHeaders,
        body: { error: "Unable to load volunteer signups." }
      };
      return;
    }
  }

  const volunteerPartition = `${projectId}|${slotId}`;
  const volunteers = [];

  try {
    const entities = volunteersClient.listEntities({ queryOptions: { filter: `PartitionKey eq '${volunteerPartition}'` } });
    for await (const entity of entities) {
      volunteers.push({
        id: entity.rowKey || entity.RowKey,
        firstName: entity.FirstName,
        lastName: entity.LastName,
        email: entity.Email,
        phone: entity.Phone,
        signedUpUtc: entity.SignedUpUtc
      });
    }
  } catch (err) {
    context.log.error("Error querying volunteer signups", err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: "Failed to load volunteers for this slot." }
    };
    return;
  }

  volunteers.sort((a, b) => (a.signedUpUtc || "").localeCompare(b.signedUpUtc || ""));

  context.res = {
    status: 200,
    headers: corsHeaders,
    body: {
      volunteers
    }
  };
};
