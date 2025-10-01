process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-key";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "distrack.api";
process.env.JWT_ISSUER = process.env.JWT_ISSUER || "distrack.backend";

const jwt = require("jsonwebtoken");
const {
    verifyAccessToken,
    hashValue,
    DEFAULT_SCOPE,
    getAccessTokenTtlSeconds,
} = require("../tokenService.js");

function run() {
    const userId = "test-user";
    const deviceId = "device-123";
    const scope = DEFAULT_SCOPE;

    const payload = {
        sub: userId,
        aud: process.env.JWT_AUDIENCE,
        scope,
        device_id: deviceId,
        jti: "test-jti",
        iat: Math.floor(Date.now() / 1000),
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
        issuer: process.env.JWT_ISSUER,
        expiresIn: getAccessTokenTtlSeconds(),
    });

    const decoded = verifyAccessToken(token);

    if (decoded.sub !== userId || decoded.device_id !== deviceId) {
        throw new Error("Decoded token payload mismatch");
    }

    const hash = hashValue(token);
    if (!hash || typeof hash !== "string") {
        throw new Error("Failed to hash token value");
    }

    console.log("✅ Token service smoke test passed");
}

run();
