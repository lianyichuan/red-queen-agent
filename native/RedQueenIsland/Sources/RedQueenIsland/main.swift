import Cocoa
import SwiftUI
import QuartzCore

func emit(_ object: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: object), var line = String(data: data, encoding: .utf8) {
        line += "\n"
        FileHandle.standardOutput.write(Data(line.utf8))
    }
}

final class IslandModel: ObservableObject {
    @Published var state = "idle"
    @Published var text = "Command link established."
    @Published var theme = "night"
    @Published var opacity = 0.94
    @Published var level = 0.0
    @Published var voice = false
    @Published var held = false
    @Published var hover = false
    @Published var pinned = false
    var onResize: (() -> Void)?
    var active: Bool { state != "idle" || held }
    var controlsVisible: Bool { hover || pinned }
    var expanded: Bool { controlsVisible || active }
    var day: Bool { theme == "day" }
    var title: String {
        if held && state == "idle" { return "DIRECTIVE HELD" }
        switch state {
        case "working": return "OPERATION ACTIVE"
        case "speaking": return "MISSION REPORT"
        case "error": return "CHANNEL FAULT"
        default: return voice ? "UPLINK ARMED" : "STANDING BY"
        }
    }
    var size: NSSize { controlsVisible ? NSSize(width: 448, height: 180) : active ? NSSize(width: 406, height: 132) : NSSize(width: 292, height: 72) }
    func receive(_ data: [String: Any]) {
        if let next = data["state"] as? String { state = next }
        if let next = data["text"] as? String { text = next }
        if let next = data["theme"] as? String { theme = next }
        if let next = data["opacity"] as? Double { opacity = min(1, max(0.3, next)) }
        if let next = data["level"] as? Double { level = min(1, max(0, next)) }
        if let next = data["voice"] as? Bool { voice = next }
        if let next = data["held"] as? Bool { held = next }
        onResize?()
    }
}

struct EnergyCore: View {
    @ObservedObject var model: IslandModel
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
            let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                let pulse = model.state == "speaking" ? model.level : (sin(time * 1.7) + 1) * 0.08
                let radius = 11 + pulse * 5
                let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
                context.addFilter(.shadow(color: .pink.opacity(0.65), radius: 7))
                context.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(colors: [.white.opacity(0.9), Color(red: 1, green: 0.24, blue: 0.47), .purple.opacity(0.1)]), center: center, startRadius: 0, endRadius: radius))
                for ring in 0..<3 {
                    var layer = context
                    layer.translateBy(x: center.x, y: center.y)
                    layer.rotate(by: .radians(time * (model.state == "working" ? 1.3 : 0.35) * (ring == 1 ? -1 : 1) + Double(ring)))
                    let path = Path(ellipseIn: CGRect(x: -21, y: -8 - CGFloat(ring) * 3, width: 42, height: 16 + CGFloat(ring) * 6))
                    layer.stroke(path, with: .color((ring == 1 ? Color.purple : Color.pink).opacity(0.7)), lineWidth: 0.85)
                }
            }
        }
        .frame(width: 50, height: 50)
        .accessibilityHidden(true)
    }
}

struct SignalField: View {
    @ObservedObject var model: IslandModel
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: reduceMotion)) { timeline in
            let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
            Canvas { context, size in
                for i in 0..<64 {
                    let x = CGFloat(i) * size.width / 64
                    let envelope = pow(sin(Double(i) / 63 * .pi), 1.4)
                    let energy = model.state == "speaking" ? model.level : model.state == "working" ? 0.4 : 0.1
                    let wave = abs(sin(Double(i) * 0.7 + time * 3) * cos(Double(i) * 0.19 - time * 2))
                    let height = 2 + envelope * (4 + energy * 29) * wave
                    context.fill(Path(roundedRect: CGRect(x: x, y: (size.height - height) / 2, width: 2, height: height), cornerRadius: 1), with: .color(Color(red: 0.92, green: 0.29, blue: 0.46).opacity(0.3 + envelope * 0.65)))
                }
            }
        }.frame(height: 29).accessibilityHidden(true)
    }
}

struct IslandView: View {
    @ObservedObject var model: IslandModel
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    var foreground: Color { model.day ? Color(red: 0.19, green: 0.16, blue: 0.22) : Color(red: 0.94, green: 0.89, blue: 0.93) }
    func action(_ icon: String, _ label: String, _ name: String) -> some View {
        Button { emit(["action": name]) } label: {
            Image(systemName: icon).font(.system(size: 12, weight: .medium)).frame(width: 28, height: 28)
        }.buttonStyle(.plain).foregroundStyle(foreground.opacity(0.8)).help(label).accessibilityLabel(label)
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button {
                    model.pinned.toggle()
                    model.onResize?()
                } label: { EnergyCore(model: model) }
                .buttonStyle(.plain).help("Toggle island controls").accessibilityLabel("Toggle island controls")
                VStack(alignment: .leading, spacing: 5) {
                    Text("RQ / " + model.title).font(.system(size: 9, weight: .semibold, design: .monospaced)).tracking(1)
                    if model.expanded {
                        Text(model.text).font(.system(size: 11)).foregroundStyle(foreground.opacity(0.7)).lineLimit(model.controlsVisible ? 2 : 1)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    } else {
                        Text("COMMAND INTELLIGENCE").font(.system(size: 7, design: .monospaced)).tracking(1.4).foregroundStyle(foreground.opacity(0.45))
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
                if model.expanded {
                    action(model.voice ? "mic.fill" : "mic.slash", model.voice ? "Pause speech recognition" : "Enable speech recognition", "voice")
                    if model.active { action("stop.fill", "Abort current operation", "stop") }
                }
                action("arrow.up.left.and.arrow.down.right", "Expand command interface", "expand")
            }.frame(height: model.controlsVisible ? 61 : 50)
            if model.expanded {
                SignalField(model: model).transition(.opacity.combined(with: .scale(scale: 0.8)))
            }
            if model.controlsVisible {
                HStack(spacing: 6) {
                    Text(model.voice ? "SPEECH RECOGNITION / ARMED" : "SPEECH RECOGNITION / PAUSED")
                        .font(.system(size: 7, design: .monospaced)).tracking(0.6).foregroundStyle(foreground.opacity(0.5))
                    Spacer()
                    action(model.day ? "moon" : "sun.max", "Switch day or night", "theme")
                    action("slider.horizontal.3", "Display configuration", "settings")
                    action("minus", "Hide interface", "hide")
                }.transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, model.expanded ? 19 : 12).padding(.vertical, 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            RoundedRectangle(cornerRadius: model.expanded ? 30 : 32)
                .fill(model.day ? Color(red: 0.95, green: 0.94, blue: 0.97) : Color(red: 0.035, green: 0.035, blue: 0.055))
                .opacity(model.opacity)
                .overlay {
                    RoundedRectangle(cornerRadius: model.expanded ? 30 : 32)
                        .fill(.ultraThinMaterial).opacity(0.13 * model.opacity)
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: model.expanded ? 30 : 32)
                .stroke(LinearGradient(colors: [Color.white.opacity(model.day ? 0.9 : 0.24), Color.pink.opacity(0.18), .white.opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
        }
        .padding(5)
        .foregroundStyle(foreground)
        .preferredColorScheme(model.day ? .light : .dark)
        .animation(reduceMotion ? nil : .spring(response: 0.46, dampingFraction: 0.83), value: model.expanded)
        .animation(reduceMotion ? nil : .spring(response: 0.46, dampingFraction: 0.83), value: model.controlsVisible)

    }
}

final class TrackingHostingView: NSHostingView<IslandView> {
    var onHoverChange: ((Bool) -> Void)?
    private var hoverArea: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let previous = hoverArea { removeTrackingArea(previous) }
        let next = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(next)
        hoverArea = next
    }
    override func mouseEntered(with event: NSEvent) { onHoverChange?(true) }
    override func mouseExited(with event: NSEvent) { onHoverChange?(false) }
}
final class IslandPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = IslandModel()
    var panel: IslandPanel!
    var requestedSize = NSSize.zero
    var pointerTimer: Timer?
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        panel = IslandPanel(contentRect: CGRect(origin: .zero, size: model.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Red Queen Island"
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.acceptsMouseMovedEvents = true
        let host = TrackingHostingView(rootView: IslandView(model: model))
        host.onHoverChange = { [weak self] hovered in
            guard let self, self.model.hover != hovered else { return }
            self.model.hover = hovered
            self.resize()
        }
        panel.contentView = host
        if let screen = NSScreen.main {
            let area = screen.visibleFrame
            panel.setFrameOrigin(CGPoint(x: area.midX - model.size.width / 2, y: area.maxY - model.size.height - 10))
        }
        // Nonactivating panels do not consistently receive SwiftUI hover events
        // across Spaces; inspect only our own visible bounds as a fallback.
        pointerTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
            guard let self else { return }
            let inside = self.panel.isVisible && NSMouseInRect(NSEvent.mouseLocation, self.panel.frame, false)
            if inside != self.model.hover { self.model.hover = inside; self.resize() }
        }
        requestedSize = model.size
        model.onResize = { [weak self] in self?.resize() }
        emit(["event": "ready", "engine": "SwiftUI/AppKit"])
        Thread.detachNewThread { [weak self] in
            while let line = readLine() {
                guard let bytes = line.data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { continue }
                DispatchQueue.main.async { self?.receive(value) }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
    func receive(_ value: [String: Any]) {
        if let command = value["command"] as? String {
            if command == "hide" { panel.orderOut(nil); model.hover = false; model.pinned = false; resize(); return }
            if command == "quit" { NSApp.terminate(nil); return }
            if command == "show" { panel.orderFrontRegardless(); return }
        }
        model.receive(value)
    }
    func resize() {
        let size = model.size
        guard size != requestedSize else { return }
        requestedSize = size
        let frame = panel.frame
        var target = CGRect(x: frame.midX - size.width / 2, y: frame.maxY - size.height, width: size.width, height: size.height)
        if let screen = panel.screen ?? NSScreen.main {
            let area = screen.visibleFrame
            target.origin.x = max(area.minX, min(target.origin.x, area.maxX - target.width))
            target.origin.y = max(area.minY, min(target.origin.y, area.maxY - target.height))
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.42
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 0.8, 0.2, 1)
            panel.animator().setFrame(target, display: true)
        }
        emit(["event": "layout", "width": size.width, "height": size.height])
    }
}
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
