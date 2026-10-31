'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
async function buildNativeIsland() {
  if (process.platform !== 'darwin') throw new Error('Native island requires macOS');
  const root = path.resolve(__dirname, '../native/RedQueenIsland');
  const source = path.join(root, 'Sources/RedQueenIsland/main.swift');
  const bundle = path.join(root, '.build/RedQueenIsland.app');
  const binary = path.join(bundle, 'Contents/MacOS/RedQueenIsland');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>RedQueenIsland</string><key>CFBundleIdentifier</key><string>com.yicongqiu.javis.island</string><key>CFBundleName</key><string>Red Queen Island</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>LSMinimumSystemVersion</key><string>14.0</string></dict></plist>`);
  if (fs.existsSync(binary) && fs.statSync(binary).mtimeMs >= Math.max(fs.statSync(source).mtimeMs, fs.statSync(__filename).mtimeMs)) return binary;
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  const temporary = binary + '.new';
  try {
    await run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`, '-O', '-framework', 'Cocoa', '-framework', 'SwiftUI', '-framework', 'QuartzCore', source, '-o', temporary], { timeout: 120000, maxBuffer: 1024 * 1024 });
    fs.renameSync(temporary, binary);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`Native island build failed: ${error.stderr || error.message}`);
  }
  return binary;
}
module.exports = { buildNativeIsland };
if (require.main === module) buildNativeIsland().then(file => console.log(file)).catch(error => { console.error(error.message); process.exitCode = 1; });
