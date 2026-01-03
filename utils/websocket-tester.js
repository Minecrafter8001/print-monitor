
// --- Simplified: One-shot status monitor matching server logic ---

const SDCPClient = require('utils/sdcp-client');
const PrinterDiscovery = require('utils/printer-discovery');
const readline = require('readline');
const { MACHINE_STATUS_LABELS, JOB_STATUS_LABELS } = require('utils/status-codes');

function parseStatusPayload(data) {
    // Matches server.js logic exactly
    const statusBlock = data?.Status || {};
    let currentStatus = statusBlock.CurrentStatus;
    if (typeof currentStatus === 'number') currentStatus = [currentStatus];
    const machineStatusCode = Array.isArray(currentStatus) && currentStatus.length ? currentStatus[0] : null;
    const machineStatus =
        machineStatusCode != null && MACHINE_STATUS_LABELS[machineStatusCode]
            ? MACHINE_STATUS_LABELS[machineStatusCode]
            : 'UNKNOWN';
    const jobStatusCode = statusBlock.PrintInfo?.Status ?? null;
    let jobStatus = null;
    if (jobStatusCode != null) {
        if (jobStatusCode === 13) {
            jobStatus = 'PRINTING';
        } else if (JOB_STATUS_LABELS[jobStatusCode]) {
            jobStatus = JOB_STATUS_LABELS[jobStatusCode];
        }
    }
    return { machine_status: machineStatus, job_status: jobStatus, machine_status_code: machineStatusCode, job_status_code: jobStatusCode };
}


async function main() {
    let printerIP = process.argv[2];
    if (!printerIP) {
        // Auto-discover printers on the LAN
        const discovery = new PrinterDiscovery();
        console.log('Discovering printers on the LAN...');
        let printers = [];
        try {
            printers = await discovery.discover(3000);
        } catch (err) {
            console.error('Discovery error:', err);
            process.exit(1);
        }
        if (!printers.length) {
            console.error('No printers found.');
            process.exit(1);
        }
        // List and prompt user to select
        printers.forEach((p, i) => {
            console.log(`${i + 1}: ${p.Name || p.name || 'Unknown'} (${p.Ip || p.address})`);
        });
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q) => new Promise(res => rl.question(q, res));
        let idx = 0;
        if (printers.length === 1) {
            idx = 0;
            console.log('Auto-selecting only discovered printer.');
        } else {
            const answer = await ask('Select printer number: ');
            idx = parseInt(answer, 10) - 1;
            if (isNaN(idx) || idx < 0 || idx >= printers.length) {
                console.error('Invalid selection.');
                rl.close();
                process.exit(1);
            }
        }
        printerIP = printers[idx].Ip || printers[idx].address;
        rl.close();
    }
    const wsClient = new SDCPClient(printerIP);
    try {
        await wsClient.connect();
        console.log('Connected to printer at', printerIP);
    } catch (err) {
        console.error('Failed to connect:', err);
        process.exit(1);
    }
    let lastMachine = null, lastJob = null;
    let lastRaw = null;
    wsClient.onStatus((msg) => {
        const rawStr = JSON.stringify(msg, null, 2);
        const parsed = parseStatusPayload(msg.Data);
        const now = new Date().toLocaleTimeString();
        let changed = false;
        if (parsed.machine_status !== lastMachine) {
            console.log(`[${now}] Machine: ${lastMachine} -> ${parsed.machine_status}`);
            lastMachine = parsed.machine_status;
            changed = true;
        }
        if (parsed.job_status !== lastJob) {
            console.log(`[${now}] Job: ${lastJob} -> ${parsed.job_status}`);
            lastJob = parsed.job_status;
            changed = true;
        }
        if (changed || rawStr !== lastRaw) {
            lastRaw = rawStr;
            console.log(rawStr);
        }
        if (!changed && rawStr === lastRaw) {
            process.stdout.write('.');
        }
    });
    wsClient.startStatusPolling(1000);
    console.log('Monitoring status. Press Ctrl+C to exit.');
    await new Promise(() => {}); // Block forever
}

main();



