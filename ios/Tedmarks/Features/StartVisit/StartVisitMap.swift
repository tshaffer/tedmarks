import CoreLocation
import GoogleMaps
import SwiftUI
import TedmarksKit

/// How a restaurant shows on the map: ours as on the website (green ring with our verdict, purple
/// ★ want to go), Google's grey; the chosen one orange with its name.
struct MapPin: Equatable {
    enum Kind: Equatable { case beenThere, wantToGo, google }
    let place: NearbyPlace
    let kind: Kind
    let glyph: String
}

/// Figma 02 · Start visit — map: Google's map around you with a pin per restaurant. Tap a pin (or
/// one of Google's own restaurant icons) to choose it. Reports where the map settles, for "Search
/// this area".
struct StartVisitMap: UIViewRepresentable {
    let pins: [MapPin]
    let selectedId: String?
    let home: CLLocationCoordinate2D?
    let onSelect: (String) -> Void
    let onSelectGoogleIcon: (String) -> Void
    /// Where the map settled, and how far it shows from there (meters, center to edge).
    let onIdle: (CLLocationCoordinate2D, Double) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> GMSMapView {
        let options = GMSMapViewOptions()
        if let home { options.camera = GMSCameraPosition(target: home, zoom: 16) }
        // The website's map style (restaurants only), when there's an iOS Map ID for it.
        if let mapID = AppConfig.googleMapID { options.mapID = GMSMapID(identifier: mapID) }
        let map = GMSMapView(options: options)
        map.delegate = context.coordinator
        map.isMyLocationEnabled = true
        map.settings.myLocationButton = true
        map.settings.rotateGestures = false
        map.settings.tiltGestures = false
        map.padding = UIEdgeInsets(top: 0, left: 0, bottom: 4, right: 4)
        return map
    }

    func updateUIView(_ map: GMSMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.update(map)
    }

    @MainActor
    final class Coordinator: NSObject, @preconcurrency GMSMapViewDelegate {
        var parent: StartVisitMap
        private var markers: [String: GMSMarker] = [:]
        private var drawn: [String: Drawn] = [:]
        private var centeredOnHome = false
        private var shownSelection: String?

        private struct Drawn: Equatable { let pin: MapPin; let selected: Bool; let label: LabelSide? }

        init(_ parent: StartVisitMap) { self.parent = parent }

        func update(_ map: GMSMapView) {
            if !centeredOnHome, let home = parent.home {
                centeredOnHome = true
                map.camera = GMSCameraPosition(target: home, zoom: 16)
            }
            let wanted = Dictionary(parent.pins.map { ($0.place.googlePlaceId, $0) }) { first, _ in first }
            for (id, marker) in markers where wanted[id] == nil {
                marker.map = nil
                markers[id] = nil
                drawn[id] = nil
            }
            let labels = labelSides(map)
            for (id, pin) in wanted {
                let next = Drawn(pin: pin, selected: id == parent.selectedId, label: labels[id])
                if drawn[id] == next { continue }
                let position = CLLocationCoordinate2D(latitude: pin.place.latitude, longitude: pin.place.longitude)
                let marker = markers[id] ?? GMSMarker(position: position)
                let view = PinView(pin: pin, selected: next.selected, label: next.label)
                marker.position = position
                marker.iconView = view
                marker.groundAnchor = view.anchor
                marker.tracksViewChanges = false
                marker.zIndex = next.selected ? 1000 : pin.kind == .google ? 1 : 10
                marker.userData = id
                marker.map = map
                markers[id] = marker
                drawn[id] = next
            }
            // A newly chosen place off screen (a search result): bring it into view.
            if let id = parent.selectedId, id != shownSelection, let pin = wanted[id], !map.bounds.isEmpty {
                shownSelection = id
                let position = CLLocationCoordinate2D(latitude: pin.place.latitude, longitude: pin.place.longitude)
                if !map.projection.visibleRegion().contains(position) { map.animate(toLocation: position) }
            }
        }

        /// Names beside the pins when zoomed in (as on the website): right if there's room, else
        /// left, else none; ours get first claim, then Google's nearest the middle.
        private func labelSides(_ map: GMSMapView) -> [String: LabelSide] {
            guard map.camera.zoom >= Self.labelZoom, !map.bounds.isEmpty else { return [:] }
            let projection = map.projection
            let point = { (pin: MapPin) in projection.point(for: CLLocationCoordinate2D(latitude: pin.place.latitude, longitude: pin.place.longitude)) }
            let pins = parent.pins.filter { map.bounds.contains(point($0)) }
            var taken = pins.map { pin in
                let size = pin.place.googlePlaceId == parent.selectedId
                    ? PinView.chosenSize(pin) : PinView.coreSize(pin.kind)
                return CGRect(x: point(pin).x - size.width / 2, y: point(pin).y - size.height / 2, width: size.width, height: size.height)
            }
            let middle = CGPoint(x: map.bounds.midX, y: map.bounds.midY)
            let order = pins.filter { $0.place.googlePlaceId != parent.selectedId }.sorted { a, b in
                if (a.kind == .google) != (b.kind == .google) { return a.kind != .google }
                return hypot(point(a).x - middle.x, point(a).y - middle.y) < hypot(point(b).x - middle.x, point(b).y - middle.y)
            }
            var sides: [String: LabelSide] = [:]
            for pin in order {
                let p = point(pin), core = PinView.coreSize(pin.kind), tag = PinView.nameTagSize(pin.place.name)
                let y = p.y - tag.height / 2
                let right = CGRect(x: p.x + core.width / 2 + PinView.gap, y: y, width: tag.width, height: tag.height)
                let left = CGRect(x: p.x - core.width / 2 - PinView.gap - tag.width, y: y, width: tag.width, height: tag.height)
                for (side, rect) in [(LabelSide.right, right), (.left, left)]
                where map.bounds.contains(rect) && !taken.contains(where: { $0.intersects(rect.insetBy(dx: -2, dy: -1)) }) {
                    sides[pin.place.googlePlaceId] = side
                    taken.append(rect)
                    break
                }
            }
            return sides
        }

        private static let labelZoom: Float = 16

        func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
            if let id = marker.userData as? String { parent.onSelect(id) }
            return true   // no Google info window
        }

        func mapView(_ mapView: GMSMapView, didTapPOIWithPlaceID placeID: String, name: String, location: CLLocationCoordinate2D) {
            parent.onSelectGoogleIcon(placeID)
        }

        func mapView(_ mapView: GMSMapView, idleAt position: GMSCameraPosition) {
            let region = mapView.projection.visibleRegion()
            let reach = CLLocation(latitude: region.farLeft.latitude, longitude: region.farLeft.longitude)
                .distance(from: CLLocation(latitude: region.nearRight.latitude, longitude: region.nearRight.longitude)) / 2
            parent.onIdle(position.target, reach)
            update(mapView)   // names follow the new view
        }
    }
}

private extension GMSVisibleRegion {
    func contains(_ point: CLLocationCoordinate2D) -> Bool {
        GMSCoordinateBounds(region: self).contains(point)
    }
}

enum LabelSide { case left, right }

/// The pin: a white rounded tag with a colored ring (ours) or a small grey dot (Google's), with
/// its name in a white tag beside it when there's room; orange with the name when chosen.
private final class PinView: UIView {
    static let gap: CGFloat = 4
    private static let nameFont = UIFont.systemFont(ofSize: 12, weight: .semibold)
    private static let nameMaxWidth: CGFloat = 150

    /// Where the place itself is within the view (the marker's ground anchor).
    private(set) var anchor = CGPoint(x: 0.5, y: 0.5)

    init(pin: MapPin, selected: Bool, label: LabelSide?) {
        let core = selected ? Self.chosen(pin) : Self.core(pin)
        let tag = selected ? nil : label.map { _ in Self.nameTag(pin.place.name) }
        let tagWidth = tag.map { $0.bounds.width + Self.gap } ?? 0
        let height = max(core.bounds.height, tag?.bounds.height ?? 0)
        super.init(frame: CGRect(x: 0, y: 0, width: core.bounds.width + tagWidth, height: height))
        let coreX = label == .left ? tagWidth : 0
        core.frame.origin = CGPoint(x: coreX, y: (height - core.bounds.height) / 2)
        addSubview(core)
        if let tag {
            tag.frame.origin = CGPoint(x: label == .left ? 0 : core.bounds.width + Self.gap, y: (height - tag.bounds.height) / 2)
            addSubview(tag)
        }
        anchor = CGPoint(x: (coreX + core.bounds.width / 2) / bounds.width, y: 0.5)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    static func coreSize(_ kind: MapPin.Kind) -> CGSize { kind == .google ? CGSize(width: 16, height: 16) : CGSize(width: 30, height: 26) }
    static func chosenSize(_ pin: MapPin) -> CGSize { chosen(pin).bounds.size }
    static func nameTagSize(_ name: String) -> CGSize { nameTag(name).bounds.size }

    /// Unchosen: Google's a grey dot; ours a white tag with a colored ring and the glyph.
    private static func core(_ pin: MapPin) -> UIView {
        if pin.kind == .google {
            let dot = UIView(frame: CGRect(origin: .zero, size: coreSize(.google)))
            dot.backgroundColor = .white
            dot.layer.cornerRadius = 8
            dot.layer.borderColor = UIColor.systemGray.cgColor
            dot.layer.borderWidth = 4
            shadow(dot, opacity: 0.2)
            return dot
        }
        let ring: UIColor = pin.kind == .beenThere ? .systemGreen : .systemPurple
        let label = UILabel()
        label.text = pin.glyph
        label.font = .systemFont(ofSize: pin.kind == .wantToGo ? 15 : 13, weight: .bold)
        label.textColor = pin.kind == .wantToGo ? .systemPurple : .secondaryLabel
        label.textAlignment = .center
        let view = UIView(frame: CGRect(origin: .zero, size: coreSize(pin.kind)))
        label.frame = view.bounds
        view.addSubview(label)
        view.backgroundColor = .white
        view.layer.cornerRadius = 13
        view.layer.borderColor = ring.cgColor
        view.layer.borderWidth = 2
        shadow(view, opacity: 0.25)
        return view
    }

    /// Chosen: orange with the glyph and the name.
    private static func chosen(_ pin: MapPin) -> UIView {
        let label = UILabel()
        let text = NSMutableAttributedString(string: pin.glyph, attributes: [
            .font: UIFont.systemFont(ofSize: pin.kind == .wantToGo ? 15 : 13, weight: .bold), .foregroundColor: UIColor.white,
        ])
        text.append(NSAttributedString(string: "  " + pin.place.name, attributes: [
            .font: UIFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: UIColor.white,
        ]))
        label.attributedText = text
        label.lineBreakMode = .byTruncatingTail
        label.sizeToFit()
        let width = min(label.bounds.width + 22, 260), height = label.bounds.height + 12
        let view = UIView(frame: CGRect(x: 0, y: 0, width: width, height: height))
        label.frame = view.bounds.insetBy(dx: 11, dy: 6)
        label.textAlignment = .center
        view.addSubview(label)
        view.backgroundColor = .systemOrange
        view.layer.cornerRadius = height / 2
        shadow(view, opacity: 0.25)
        return view
    }

    /// The name beside a pin: a small white tag, so it reads over the map.
    private static func nameTag(_ name: String) -> UIView {
        let label = UILabel()
        label.text = name
        label.font = nameFont
        label.textColor = .label
        label.lineBreakMode = .byTruncatingTail
        label.sizeToFit()
        let width = min(label.bounds.width, nameMaxWidth) + 8, height = label.bounds.height + 4
        let tag = UIView(frame: CGRect(x: 0, y: 0, width: width, height: height))
        label.frame = tag.bounds.insetBy(dx: 4, dy: 2)
        tag.addSubview(label)
        tag.backgroundColor = UIColor.white.withAlphaComponent(0.92)
        tag.layer.cornerRadius = 4
        shadow(tag, opacity: 0.12)
        return tag
    }

    private static func shadow(_ view: UIView, opacity: Float) {
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = opacity
        view.layer.shadowRadius = 2
        view.layer.shadowOffset = CGSize(width: 0, height: 1)
    }
}
