require('module-alias/register');

// Suppress console.error during tests (expected connection errors)
const originalError = console.error;
const silencePatterns = [
  'Failed to request status',
  'Not connected to printer',
  'Connection failed',
  // jsdom emits this when tests assign window.location in ways not implemented
  'Not implemented: navigation'
];

console.error = (...args) => {
  const fullMessage = args.join(' ');
  if (silencePatterns.some(pattern => fullMessage.includes(pattern))) {
    return; // Suppress expected errors
  }
  originalError(...args);
};
