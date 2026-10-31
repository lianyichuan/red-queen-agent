# Red Queen Agent — Native Island

SwiftUI + AppKit companion for the Red Queen Agent desktop app, macOS 14 or later. Open `Package.swift` in Xcode to build the native executable. The app is a nonactivating accessory NSPanel; it shares the existing Electron executor and speech output instead of creating a second agent session.

From the project root, `npm run build:island` builds a local `.build/RedQueenIsland.app` bundle with the installed Xcode Swift compiler. `npm start`, then use the compact button to start it with the host's stdin/stdout connection. The generated bundle is a host-owned helper; directly opening it without a connection exits on stdin EOF.

JSONL input supports a snapshot (`state`, `text`, `voice`, `held`, `theme`, `opacity`, `level`) and `{"command":"show"}`, `hide`, or `quit`. Output reports readiness, layout size and operator actions. Only the host can execute directives. The helper sends `expand`, `voice`, `stop`, `settings`, `theme`, `hide` actions; the host validates them against known handlers.

Window sizes in points: standby 292 × 72, active task/report/held directive 406 × 132, controls 448 × 180. AppKit animates the actual window frame in 0.42 seconds; SwiftUI uses spring transitions for its contents. Core/signal drawing follows Reduce Motion. Window resizing stays inside the current display's visible area. Hover expands controls, clicking the core pins them open. Background opacity is independent of text and controls.

The host retains the current renderer/audio context while hidden, turns off background throttling, and forwards audio analyser levels every 40 ms during playback. Full reports and held speech directives remain accessible in the full interface. Native crash or readiness failure restores the web compact window. Parent exit closes stdin and terminates the helper.
