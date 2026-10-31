'use strict';
// Runs in a real Rex terminal. Incremental reads avoid subprocesses and retain
// readable scrollback after the Electron app exits or is restarted.
const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');
const file = process.argv[2];
let offset = 0;
let decoder = new StringDecoder('utf8');
console.log('\x1b[38;5;203mRED QUEEN  /  LIVE OPERATIONS\x1b[0m');
console.log('Actual tool activity, command output and mission results · Ctrl+C to stop observing\n');
function read() {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < offset) { offset = 0; decoder = new StringDecoder('utf8'); }
    const length = Math.min(size - offset, 65536);
    if (length > 0) {
      const buffer = Buffer.alloc(length);
      const count = fs.readSync(fd, buffer, 0, length, offset);
      process.stdout.write(decoder.write(buffer.subarray(0, count)));
      offset += count;
    }
  } catch (e) { if (e.code !== 'ENOENT') console.error('Observation channel: ', e.code); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
read();
setInterval(read, 250);
