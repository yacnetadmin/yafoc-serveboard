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
    console.warn("Token tenant does not match configured tenant (update-slot)", { configuredTenantId, tokenTenantId });
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
        console.warn("Microsoft token validation failed (update-slot)", {
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
      console.log("Microsoft token validated (update-slot)", {
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

  const updates = req.body || {};
  if (Object.keys(updates).length === 0) {
    context.res = {
      status: 400,
      body: { error: "No fields provided to update." }
    };
    return;
  }

  const connectionString = process.env["AzureWebJobsStorage"] || process.env["TableStorageConnectionString"];
  if (!connectionString) {
    context.log.error("No storage connection string configured for slot update");
    context.res = {
      status: 500,
      body: { error: "Storage configuration missing." }
    };
    return;
  }

  const client = TableClient.fromConnectionString(connectionString, "Slots");

  let existing;
  try {
    existing = await client.getEntity(projectId, slotId);
  } catch (err) {
    if (err.statusCode === 404) {
      context.res = {
        status: 404,
        body: { error: "Slot not found." }
      };
      return;
    }
    context.log.error("Error retrieving slot for update", err);
    context.res = {
      status: 500,
      body: { error: "Failed to load slot." }
    };
    return;
  }

  const allowedFields = ["task", "date", "time", "status", "volunteer"];
  const payload = {};
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      payload[key] = updates[key];
    }
  }

  if (Object.keys(payload).length === 0) {
    context.res = {
      status: 400,
      body: { error: "No recognized fields provided to update." }
    };
    return;
  }

  const entityUpdate = {
    PartitionKey: projectId,
    RowKey: slotId
  };

  if (payload.task !== undefined) entityUpdate.Task = payload.task;
  if (payload.date !== undefined) entityUpdate.Date = payload.date;
  if (payload.time !== undefined) entityUpdate.Time = payload.time;
  if (payload.status !== undefined) entityUpdate.Status = payload.status;

  if (payload.volunteer) {
    entityUpdate.VolunteerEmail = payload.volunteer.email || "";
    entityUpdate.VolunteerFirstName = payload.volunteer.firstName || "";
    entityUpdate.VolunteerLastName = payload.volunteer.lastName || "";
    entityUpdate.VolunteerPhone = payload.volunteer.phone || "";
  } else if (payload.volunteer === null) {
    entityUpdate.VolunteerEmail = "";
    entityUpdate.VolunteerFirstName = "";
    entityUpdate.VolunteerLastName = "";
    entityUpdate.VolunteerPhone = "";
  }

  if (payload.volunteer === null) {
    payload.volunteer = null;
  }

  try {
    entityUpdate.etag = existing.etag;
    await client.updateEntity(entityUpdate, "Merge");
  } catch (err) {
    context.log.error("Error updating slot", err);
    context.res = {
      status: 500,
      body: { error: "Failed to update slot." }
    };
    return;
  }

  const response = {
    id: slotId,
    task: payload.task !== undefined ? payload.task : existing.Task,
    date: payload.date !== undefined ? payload.date : existing.Date,
    time: payload.time !== undefined ? payload.time : existing.Time,
    status: payload.status !== undefined ? payload.status : existing.Status,
    volunteer: payload.volunteer !== undefined ? payload.volunteer : (existing.VolunteerEmail ? {
      email: existing.VolunteerEmail,
      firstName: existing.VolunteerFirstName,
      lastName: existing.VolunteerLastName,
      phone: existing.VolunteerPhone
    } : null)
  };

  context.res = {
    status: 200,
    body: {
      message: "Slot updated successfully.",
      slot: response
    }
  };
};
