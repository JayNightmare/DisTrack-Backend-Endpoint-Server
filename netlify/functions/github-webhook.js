// netlify/functions/github-webhook.js
const crypto = require('crypto');

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

function verifyGitHubSignature(req) {
    const signature = req.headers['x-hub-signature-256'];
    const payload = JSON.stringify(req.body);
    const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const body = JSON.parse(event.body);
    const { action, sender } = body;

    // Verify the GitHub signature
    if (!verifyGitHubSignature(event)) {
        return { statusCode: 403, body: 'Forbidden' };
    }

    if (action === 'created') {
        const githubUsername = sender.login;
        // Process the event as needed (e.g., set user to premium)
        return {
            statusCode: 200,
            body: JSON.stringify({ message: `${githubUsername} is now a premium member!` })
        };
    }

    return { statusCode: 200, body: 'No action taken' };
};
