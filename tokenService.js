const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const Device = require("./Device.js");
const RefreshToken = require("./RefreshToken.js");
const {
    JWT_SECRET,
    JWT_AUDIENCE,
    JWT_ISSUER,
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_DAYS,
} = require("./config.js");

const DEFAULT_SCOPE = "write:sessions";

function hashValue(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function nowUtcSeconds() {
    return Math.floor(Date.now() / 1000);
}

function getAccessTokenExpiry() {
    return ACCESS_TOKEN_TTL_SECONDS || 900;
}

function getRefreshTokenExpiryDate() {
    const ttlDays = REFRESH_TOKEN_TTL_DAYS || 60;
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);
    return expiresAt;
}

function generateJti() {
    return crypto.randomUUID();
}

function generateAccessToken({ userId, deviceId, scope = DEFAULT_SCOPE }) {
    const expiresIn = getAccessTokenExpiry();
    const payload = {
        sub: userId,
        aud: JWT_AUDIENCE,
        scope,
        device_id: deviceId,
        jti: generateJti(),
        iat: nowUtcSeconds(),
    };

    const token = jwt.sign(payload, JWT_SECRET, {
        expiresIn,
        issuer: JWT_ISSUER,
    });

    return { token, expiresIn };
}

function verifyAccessToken(rawToken) {
    return jwt.verify(rawToken, JWT_SECRET, {
        audience: JWT_AUDIENCE,
        issuer: JWT_ISSUER,
        clockTolerance: 120,
    });
}

function generateOpaqueToken() {
    return crypto.randomBytes(32).toString("base64url");
}

async function ensureDevice({ userId, deviceId, ipHash, userAgent }) {
    const update = {
        userId,
        lastSeenAt: new Date(),
    };
    if (ipHash) update.lastIpHash = ipHash;
    if (userAgent) update.userAgent = userAgent;

    const options = { upsert: true, new: true, setDefaultsOnInsert: true };
    await Device.findOneAndUpdate({ deviceId }, update, options).exec();
}

async function revokeActiveTokensForDevice(deviceId) {
    await RefreshToken.updateMany(
        {
            deviceId,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
        },
        { $set: { revokedAt: new Date() } }
    );
}

async function issueTokenPair({ userId, deviceId, ipHash, userAgent }) {
    await ensureDevice({ userId, deviceId, ipHash, userAgent });
    await revokeActiveTokensForDevice(deviceId);

    const { token: accessToken, expiresIn } = generateAccessToken({
        userId,
        deviceId,
    });

    const refreshTokenRaw = generateOpaqueToken();
    const tokenDoc = new RefreshToken({
        userId,
        deviceId,
        tokenHash: hashValue(refreshTokenRaw),
        expiresAt: getRefreshTokenExpiryDate(),
        metadata: {
            ipHash: ipHash || null,
            userAgent: userAgent || null,
        },
    });

    await tokenDoc.save();

    return {
        accessToken,
        refreshToken: refreshTokenRaw,
        expiresIn,
        refreshTokenId: tokenDoc._id,
    };
}

async function findValidRefreshToken(deviceId, rawToken) {
    const tokenHash = hashValue(rawToken);
    const doc = await RefreshToken.findOne({
        deviceId,
        tokenHash,
    }).exec();

    if (!doc) return null;

    if (doc.revokedAt) return null;
    if (doc.expiresAt <= new Date()) {
        await RefreshToken.updateOne(
            { _id: doc._id },
            { $set: { revokedAt: new Date() } }
        );
        return null;
    }

    return doc;
}

async function rotateRefreshToken(tokenDoc, { ipHash, userAgent }) {
    const { userId, deviceId } = tokenDoc;

    await RefreshToken.updateOne(
        { _id: tokenDoc._id },
        { $set: { revokedAt: new Date() } }
    );

    const { accessToken, refreshToken, expiresIn, refreshTokenId } =
        await issueTokenPair({
            userId,
            deviceId,
            ipHash,
            userAgent,
        });

    await RefreshToken.updateOne(
        { _id: tokenDoc._id },
        { $set: { replacedByToken: refreshTokenId } }
    );

    return { accessToken, refreshToken, expiresIn };
}

function getAccessTokenTtlSeconds() {
    return getAccessTokenExpiry();
}

module.exports = {
    issueTokenPair,
    verifyAccessToken,
    findValidRefreshToken,
    rotateRefreshToken,
    hashValue,
    getAccessTokenTtlSeconds,
    DEFAULT_SCOPE,
};
