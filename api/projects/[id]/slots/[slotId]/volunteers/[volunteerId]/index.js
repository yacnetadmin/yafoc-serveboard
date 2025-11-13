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
    console.warn("Token tenant does not match configured tenant (slot volunteer delete)", { configuredTenantId, tokenTenantId });
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
        console.warn("Microsoft token validation failed (slot volunteer delete)", {
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
      console.log("Microsoft token validated (slot volunteer delete)", {
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
    "Access-Control-Allow-Methods": "DELETE, OPTIONS",
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
    context.log.error("Configuration error while validating Microsoft token (slot volunteer delete)", configError);
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
  const volunteerId = context.bindingData.volunteerId;

  if (!volunteerId) {
    context.res = {
      status: 400,
      headers: corsHeaders,
      body: { error: "Missing volunteer identifier." }
    };
    return;
  }

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
  const slotsClient = TableClient.fromConnectionString(connectionString, "Slots");

  const volunteerPartition = `${projectId}|${slotId}`;

  let volunteerEntity;
  try {
    volunteerEntity = await volunteersClient.getEntity(volunteerPartition, volunteerId);
  } catch (err) {
    if (err.statusCode === 404) {
      context.res = {
        status: 404,
        headers: corsHeaders,
        body: { error: "Volunteer signup not found." }
      };
      return;
    }
    context.log.error("Error retrieving volunteer signup", err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: "Failed to load volunteer signup." }
    };
    return;
  }

  try {
    await volunteersClient.deleteEntity(volunteerPartition, volunteerId, volunteerEntity.etag ? { etag: volunteerEntity.etag } : undefined);
  } catch (err) {
    context.log.error("Error deleting volunteer signup", err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: "Failed to remove volunteer from slot." }
    };
    return;
  }

  let updatedSlot;
  try {
    const slot = await slotsClient.getEntity(projectId, slotId);
    const rawCapacity = parseInt(slot.Capacity ?? slot.capacity ?? 1, 10);
    const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
    const rawFilled = parseInt(slot.FilledCount ?? slot.filledCount ?? (slot.VolunteerEmail ? 1 : 0), 10);
    const filledCount = Math.max(0, Number.isFinite(rawFilled) ? rawFilled : 0);
    const nextFilled = Math.max(0, filledCount - 1);
    const currentStatus = (slot.Status || "").toLowerCase();
    const nextStatus = currentStatus === "held"
      ? "held"
      : (nextFilled >= capacity ? "filled" : "available");

    await slotsClient.updateEntity({
      partitionKey: projectId,
      rowKey: slotId,
      PartitionKey: projectId,
      RowKey: slotId,
      FilledCount: nextFilled,
      Status: nextStatus
    }, "Merge", slot.etag ? { etag: slot.etag } : { etag: "*" });

    updatedSlot = {
      capacity,
      filledCount: nextFilled,
      spotsRemaining: Math.max(0, capacity - nextFilled),
      status: nextStatus
    };
  } catch (err) {
    context.log.error("Error updating slot counts after volunteer removal", err);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: "Volunteer removed, but slot counts failed to update. Please refresh." }
    };
    return;
  }

  context.res = {
    status: 200,
    headers: corsHeaders,
    body: {
      message: "Volunteer removed from slot.",
      slot: updatedSlot,
      volunteer: {
        id: volunteerEntity.rowKey || volunteerEntity.RowKey,
        firstName: volunteerEntity.FirstName,
        lastName: volunteerEntity.LastName,
        email: volunteerEntity.Email,
        phone: volunteerEntity.Phone
      }
    }
  };
};
