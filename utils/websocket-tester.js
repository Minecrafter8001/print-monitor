const SDCPClient = require('./sdcp-client');
const PrinterDiscovery = require('./printer-discovery');
const readline = require('readline');

// Helper to prompt user
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

let wsClient = null;

const discovery = new PrinterDiscovery();

function printMenu() {
	console.log('\nElegoo WebSocket Tester');
	console.log('1. Discover printers');
	console.log('2. Connect to printer');
	console.log('3. Send status command');
	console.log('4. Send attributes command');
	console.log('5. Send camera URL command');
	console.log('6. Send custom command');
	console.log('0. Exit');
}

function ask(question) {
	return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
	let printerIP = null;
	let mainboardID = null;
	while (true) {
		printMenu();
		const choice = await ask('Select option: ');
		if (choice === '0') break;
		if (choice === '1') {
			console.log('Discovering printers...');
			try {
				const printers = await discovery.discover(3000);
				if (printers.length === 0) {
					console.log('No printers found.');
				} else {
					printers.forEach((p, i) => {
						console.log(`${i + 1}: ${p.Name || p.name || 'Unknown'} (${p.Ip || p.address})`);
					});
				}
			} catch (err) {
				console.error('Discovery error:', err);
			}
		} else if (choice === '2') {
			printerIP = await ask('Enter printer IP: ');
			wsClient = new SDCPClient(printerIP);
			try {
				await wsClient.connect();
				console.log('Connected to printer.');
			} catch (err) {
				console.error('Failed to connect:', err);
				wsClient = null;
			}
		} else if (choice === '3') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			try {
				const res = await wsClient.sendCommand(0, {});
				console.log('Status response:', res);
			} catch (err) {
				console.error(err);
			}
		} else if (choice === '4') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			try {
				const res = await wsClient.sendCommand(1, {});
				console.log('Attributes response:', res);
			} catch (err) {
				console.error(err);
			}
		} else if (choice === '5') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			try {
				const res = await wsClient.sendCommand(386, {});
				console.log('Camera URL response:', res);
			} catch (err) {
				console.error(err);
			}
		} else if (choice === '6') {
			if (!wsClient) { console.log('Not connected.'); continue; }
			const cmd = parseInt(await ask('Enter Cmd ID (number): '), 10);
			const dataStr = await ask('Enter Data payload (JSON): ');
			let data = {};
			try { data = JSON.parse(dataStr); } catch { console.log('Invalid JSON, using empty object.'); }
			try {
				const res = await wsClient.sendCommand(cmd, data);
				console.log('Custom command response:', res);
			} catch (err) {
				console.error(err);
			}
		} else {
			console.log('Unknown option.');
		}
	}
	rl.close();
	if (wsClient && wsClient.disconnect) wsClient.disconnect();
	process.exit(0);
}

main();



