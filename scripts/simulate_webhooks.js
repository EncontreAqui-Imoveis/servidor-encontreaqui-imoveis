console.log("Simulating Webhooks...");

async function sendWebhook(platform, status, impact, type = '') {
    const url = `http://localhost:3000/admin/dashboard/webhook/${platform}`;

    // Mount payload depending on platform
    let payload = {};
    if (platform === 'github') {
        payload = {
            repository: { name: 'backend' },
            head_commit: {
                id: Math.random().toString(36).substring(2, 9),
                message: impact
            }
        };
    } else {
        payload = {
            project: { name: 'backend' },
            status: status,
            type: type,
            deployment: {
                meta: {
                    commitHash: Math.random().toString(36).substring(2, 9),
                    commitMessage: impact
                }
            }
        };
    }

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log(`[${platform}] Sent ${status || type}. Res: ${res.status}`);
    } catch (e) {
        console.error(`Error sending webhook to ${url}:`, e.message);
    }
}

async function runSimulation() {
    console.log("1. Simulating Github Push (Building state)...");
    await sendWebhook('github', null, "New Feature Login");

    setTimeout(async () => {
        console.log("2. Simulating Railway OOM Crash (Failed state)...");
        await sendWebhook('railway', 'CRASHED', "Crash on Node module", "DEPLOYMENT_OOM_KILLED");
    }, 4000);
}

runSimulation();
