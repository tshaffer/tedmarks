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
    let onIdle: (CLLocationCoordinate2D) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> GMSMapView {
        let options = GMSMapViewOptions()
        if let home { options.camera = GMSCameraPosition(target: home, zoom: 16) }
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
        private var drawn: [String: (MapPin, Bool)] = [:]
        private var centeredOnHome = false
        private var shownSelection: String?

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
            for (id, pin) in wanted {
                let selected = id == parent.selectedId
                if let previous = drawn[id], previous.0 == pin, previous.1 == selected { continue }
                let marker = markers[id] ?? GMSMarker(position: CLLocationCoordinate2D(latitude: pin.place.latitude, longitude: pin.place.longitude))
                marker.position = CLLocationCoordinate2D(latitude: pin.place.latitude, longitude: pin.place.longitude)
                marker.iconView = PinView(pin: pin, selected: selected)
                marker.groundAnchor = CGPoint(x: 0.5, y: 0.5)
                marker.tracksViewChanges = false
                marker.zIndex = selected ? 1000 : pin.kind == .google ? 1 : 10
                marker.userData = id
                marker.map = map
                markers[id] = marker
                drawn[id] = (pin, selected)
            }
            // A newly chosen place off screen (a search result): bring it into view.
            if let id = parent.selectedId, id != shownSelection, let pin = wanted[id], !map.bounds.isEmpty {
                shownSelection = id
                let position = CLLocationCoordinate2D(latitude: pin.place.latitude, longitude: pin.place.longitude)
                if !map.projection.visibleRegion().contains(position) { map.animate(toLocation: position) }
            }
        }

        func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
            if let id = marker.userData as? String { parent.onSelect(id) }
            return true   // no Google info window
        }

        func mapView(_ mapView: GMSMapView, didTapPOIWithPlaceID placeID: String, name: String, location: CLLocationCoordinate2D) {
            parent.onSelectGoogleIcon(placeID)
        }

        func mapView(_ mapView: GMSMapView, idleAt position: GMSCameraPosition) {
            parent.onIdle(position.target)
        }
    }
}

private extension GMSVisibleRegion {
    func contains(_ point: CLLocationCoordinate2D) -> Bool {
        GMSCoordinateBounds(region: self).contains(point)
    }
}

/// The pin itself: a white rounded tag with a colored ring, or orange with the name when chosen.
/// Google's (not ours) are just small grey dots until chosen, so a busy street stays readable.
private final class PinView: UIView {
    init(pin: MapPin, selected: Bool) {
        super.init(frame: .zero)
        if pin.kind == .google && !selected {
            frame = CGRect(x: 0, y: 0, width: 16, height: 16)
            backgroundColor = .white
            layer.cornerRadius = 8
            layer.borderColor = UIColor.systemGray.cgColor
            layer.borderWidth = 4
            layer.shadowColor = UIColor.black.cgColor
            layer.shadowOpacity = 0.2
            layer.shadowRadius = 2
            layer.shadowOffset = CGSize(width: 0, height: 1)
            return
        }
        let ring: UIColor = switch pin.kind {
        case .beenThere: .systemGreen
        case .wantToGo: .systemPurple
        case .google: .systemGray
        }
        let label = UILabel()
        let glyph = NSAttributedString(string: pin.glyph, attributes: [
            .font: UIFont.systemFont(ofSize: pin.kind == .wantToGo ? 15 : 13, weight: .bold),
            .foregroundColor: selected ? UIColor.white : (pin.kind == .wantToGo ? UIColor.systemPurple : UIColor.secondaryLabel),
        ])
        let text = NSMutableAttributedString(attributedString: glyph)
        if selected {
            text.append(NSAttributedString(string: "  " + pin.place.name, attributes: [
                .font: UIFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: UIColor.white,
            ]))
        }
        label.attributedText = text
        label.sizeToFit()
        let padX: CGFloat = selected ? 11 : 6, padY: CGFloat = selected ? 6 : 4
        let width = min(max(label.bounds.width + padX * 2, label.bounds.height + padY * 2), 260)
        frame = CGRect(x: 0, y: 0, width: width, height: label.bounds.height + padY * 2)
        label.frame = bounds.insetBy(dx: padX, dy: padY)
        label.textAlignment = .center
        label.lineBreakMode = .byTruncatingTail
        addSubview(label)
        backgroundColor = selected ? .systemOrange : .white
        layer.cornerRadius = bounds.height / 2
        if !selected {
            layer.borderColor = ring.cgColor
            layer.borderWidth = 2
        }
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.25
        layer.shadowRadius = 3
        layer.shadowOffset = CGSize(width: 0, height: 2)
    }

    required init?(coder: NSCoder) { fatalError("not used") }
}
