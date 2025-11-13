// api/projects/index.js
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
    console.warn("Token tenant does not match configured tenant", { configuredTenantId, tokenTenantId });
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
        console.warn("Microsoft token validation failed", {
          message: err.message,
          code: err.code,
          name: err.name,
          kid: tokenHeader.kid,
          x5t: tokenHeader.x5t,
          audience: decoded && decoded.payload ? decoded.payload.aud : undefined,
          issuer: decoded && decoded.payload ? decoded.payload.iss : undefined,
          tenant: decoded && decoded.payload ? decoded.payload.tid : undefined,
          jwksUri
        });
        return resolve(null);
      }
      console.log("Microsoft token validated", {
        audience: decodedToken.aud,
        issuer: decodedToken.iss,
        subject: decodedToken.sub
      });
      resolve(decodedToken);
    });
  });
}

module.exports = async function (context, req) {
  try {
    context.log(`${req.method} /api/projects called`);
    
    if (req.method === "OPTIONS") {
      context.res = {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Credentials": "true"
        }
      };
      return;
    }

    // Use connection string from environment variable (set in local.settings.json or Azure)
    const connectionString = process.env["AzureWebJobsStorage"] || process.env["TableStorageConnectionString"];
    if (!connectionString) {
      throw new Error("No storage connection string found in AzureWebJobsStorage or TableStorageConnectionString");
    }
    // Log which connection string we're using (without the actual key)
    const source = process.env["AzureWebJobsStorage"] ? "AzureWebJobsStorage" : "TableStorageConnectionString";
    context.log(`Using table storage connection string from ${source}`);
    // Validate connection string format
    if (!connectionString.includes("DefaultEndpointsProtocol=") || !connectionString.includes("AccountName=")) {
      throw new Error("Storage connection string appears to be invalid");
    }
    
    const tableName = "Projects";
    context.log("Creating table client for table:", tableName);
    const client = TableClient.fromConnectionString(connectionString, tableName);
    
    // Try to create table if it doesn't exist
    try {
      context.log("Creating table if it doesn't exist");
      await client.createTable();
      context.log("Table creation successful or table already exists");
    } catch (err) {
      context.log.error("Error creating table:", {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        details: err.details,
        name: err.name
      });
      if (err.statusCode !== 409) { // 409 means table already exists, which is fine
        throw err; // Keep original error for better debugging
      }
      context.log("Table already exists, continuing...");
    }
    
    // Validate table exists by attempting to query it
    try {
      context.log("Attempting to validate table connection...");
      const testQuery = client.listEntities({ maxPerPage: 1 });
      const result = await testQuery.next();
      context.log("Table connection validated successfully", result.done ? "- table is empty" : "- table has data");
    } catch (err) {
      context.log.error("Failed to validate table connection:", {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        details: err.details,
        name: err.name
      });
      throw err; // Keep original error for better debugging
    }

    let projects = [];
    if (req.method === "POST") {
      let user;
      try {
        context.log("Auth header:", req.headers["authorization"]);
        user = await validateMicrosoftToken(req.headers["authorization"]);
      } catch (configError) {
        context.log.error("Configuration error while validating Microsoft token:", configError);
        context.res = {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true"
          },
          body: { error: "Server configuration error. Please contact an administrator." }
        };
        return;
      }
      if (!user) {
        context.res = {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true"
          },
          body: { error: "Unauthorized. Please sign in with Microsoft." }
        };
        return;
      }

      // Handle project creation
      const project = req.body;
      if (!project || !project.title || !project.description || !project.contactEmail) {
        context.res = {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true"
          },
          body: { error: "Missing required fields: title, description, and contactEmail" }
        };
        return;
      }

      try {
        const projectId = Buffer.from(Math.random().toString()).toString('base64').substring(0, 8);
        const category = project.category || 'General';
        
        await client.createEntity({
          partitionKey: category,
          rowKey: projectId,
          Title: project.title,
          Description: project.description,
          ContactEmail: project.contactEmail,
          ContactFirstName: project.contactFirstName || '',
          ContactLastName: project.contactLastName || '',
          ContactPhone: project.contactPhone || ''
        });

        context.res = {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://yacnetadmin.github.io",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true"
          },
          body: {
            projectId,
            category,
            message: "Project created successfully"
          }
        };
        return;
      } catch (err) {
        context.log.error("Error creating project:", err);
        const errorMessage = err.message || "Unknown error occurred";
        const errorDetails = {
            message: errorMessage,
            code: err.code,
            statusCode: err.statusCode,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        };
        context.log.error("Error details:", errorDetails);
        
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
            error: "Failed to create project",
            details: errorDetails
          }
        };
        return;
      }
    }

  // Handle GET request
  try {
    // Query all entities in the Projects table
    const entities = client.listEntities();
    for await (const entity of entities) {
      const project = {
        id: entity.rowKey || entity.RowKey,
        category: entity.partitionKey || entity.PartitionKey,
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

  const totalsByProject = new Map();
  try {
    const slotsClient = TableClient.fromConnectionString(connectionString, "Slots");
    const slotEntities = slotsClient.listEntities();
    for await (const slot of slotEntities) {
      const projectKey = slot.partitionKey || slot.PartitionKey;
      if (!projectKey) continue;
      const rawCapacity = parseInt(slot.Capacity ?? slot.capacity ?? 1, 10);
      const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : 1;
      const rawFilled = parseInt(slot.FilledCount ?? slot.filledCount ?? (slot.VolunteerEmail ? 1 : 0), 10);
      const filled = Math.max(0, Number.isFinite(rawFilled) ? rawFilled : 0);
      const current = totalsByProject.get(projectKey) || { slots: 0, capacity: 0, filled: 0 };
      current.slots += 1;
      current.capacity += capacity;
      current.filled += Math.min(filled, capacity);
      totalsByProject.set(projectKey, current);
    }
  } catch (slotErr) {
    if (slotErr.statusCode === 404) {
      context.log("Slots table not found while aggregating project totals. Continuing with zero counts.");
    } else {
      context.log.warn("Unable to aggregate slot totals for projects", {
        message: slotErr.message,
        code: slotErr.code,
        statusCode: slotErr.statusCode
      });
    }
  }

  projects = projects.map((project) => {
    const totals = totalsByProject.get(project.id) || { slots: 0, capacity: 0, filled: 0 };
    const spotsRemaining = Math.max(0, totals.capacity - totals.filled);
    return {
      ...project,
      totalSlots: totals.slots,
      totalVolunteersNeeded: totals.capacity,
      totalVolunteersFilled: totals.filled,
      totalSpotsRemaining: spotsRemaining,
      hasOpenSlots: spotsRemaining > 0
    };
  });

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
