import Foundation
import SwiftData

/// Who a rating is for: the "Us / Ted / Lori" switch.
public enum RateFor: Hashable, Sendable {
    case us
    case person(UUID)
}

/// Ordering dishes and rating dishes/visits (Figma 04 Rate a dish, 05 Wrap up).
@MainActor
public enum DishCapture {

    // MARK: - Our order

    /// This visit's dishes, in the order added.
    public static func orderItems(for visit: Visit) -> [VisitItem] {
        visit.items.filter { $0.deletedAt == nil }.sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Adds a dish by name to the visit (reusing the place's dish if it already exists,
    /// and the visit's line if it's already in our order).
    @discardableResult
    public static func addItem(
        named name: String, to visit: Visit, addedVia: VisitItemAddedVia, in context: ModelContext, now: Date = .now
    ) throws -> VisitItem? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let place = visit.place else { return nil }
        let source = switch addedVia {
        case .order: "order"
        case .voice: "voice"
        default: "manual"
        }
        let placeItem = placeItem(named: trimmed, at: place, source: source, in: context, now: now)
        return try addItem(placeItem, to: visit, addedVia: addedVia, in: context, now: now)
    }

    /// Adds an existing place dish (e.g. from "Ordered before") to the visit.
    @discardableResult
    public static func addItem(
        _ placeItem: PlaceItem, to visit: Visit, addedVia: VisitItemAddedVia, in context: ModelContext, now: Date = .now
    ) throws -> VisitItem {
        if let existing = orderItems(for: visit).first(where: { $0.placeItem?.id == placeItem.id }) {
            return existing
        }
        let item = VisitItem(visit: visit, placeItem: placeItem, addedVia: addedVia, sortOrder: nextSortOrder(visit), now: now)
        context.insert(item)
        visit.modifiedAt = now
        try context.save()
        VisitSideEffects.reconcile(in: context)
        return item
    }

    /// One more of a dish: adds it to our order, or makes an ordered dish ×2, ×3…
    @discardableResult
    public static func addOne(
        _ placeItem: PlaceItem, to visit: Visit, addedVia: VisitItemAddedVia, in context: ModelContext, now: Date = .now
    ) throws -> VisitItem {
        guard let existing = orderItems(for: visit).first(where: { $0.placeItem?.id == placeItem.id }) else {
            return try addItem(placeItem, to: visit, addedVia: addedVia, in: context, now: now)
        }
        existing.quantity = existing.count + 1
        existing.modifiedAt = now
        visit.modifiedAt = now
        try context.save()
        return existing
    }

    /// One more of a dish typed by name (a new place dish if we've never had it).
    @discardableResult
    public static func addOne(
        named name: String, to visit: Visit, addedVia: VisitItemAddedVia, in context: ModelContext, now: Date = .now
    ) throws -> VisitItem? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let place = visit.place else { return nil }
        let placeItem = placeItem(named: trimmed, at: place, source: addedVia == .voice ? "voice" : "order", in: context, now: now)
        return try addOne(placeItem, to: visit, addedVia: addedVia, in: context, now: now)
    }

    /// One fewer of a dish; the last one leaves our order (with its ratings).
    public static func removeOne(_ item: VisitItem, in context: ModelContext, now: Date = .now) throws {
        guard item.count > 1 else { return try removeItem(item, in: context, now: now) }
        item.quantity = item.count - 1
        item.modifiedAt = now
        item.visit?.modifiedAt = now
        try context.save()
    }

    /// Adds "Dish N" for a dish we'll name later (receipt, voice, or editing).
    @discardableResult
    public static func addUnnamedItem(to visit: Visit, in context: ModelContext, now: Date = .now) throws -> VisitItem {
        let label = "Dish \(orderItems(for: visit).count + 1)"
        let item = VisitItem(visit: visit, placeItem: nil, placeholderLabel: label, addedVia: .rating, sortOrder: nextSortOrder(visit), now: now)
        context.insert(item)
        visit.modifiedAt = now
        try context.save()
        VisitSideEffects.reconcile(in: context)
        return item
    }

    /// Removes a dish from our order (tombstoned) along with its ratings.
    public static func removeItem(_ item: VisitItem, in context: ModelContext, now: Date = .now) throws {
        item.deletedAt = now
        item.modifiedAt = now
        for rating in try ratings(for: item.id, in: context) {
            rating.deletedAt = now
            rating.modifiedAt = now
        }
        try context.save()
        VisitSideEffects.reconcile(in: context)
    }

    /// Dishes ordered on earlier visits to this place that aren't in this visit's order yet,
    /// most recently ordered first.
    public static func orderedBefore(at place: Place, excluding visit: Visit) -> [PlaceItem] {
        let current = Set(orderItems(for: visit).compactMap { $0.placeItem?.id })
        var lastOrdered: [UUID: Date] = [:]
        var byId: [UUID: PlaceItem] = [:]
        for other in place.visits where other.id != visit.id && other.deletedAt == nil {
            for line in orderItems(for: other) {
                guard let placeItem = line.placeItem, placeItem.deletedAt == nil, !current.contains(placeItem.id) else { continue }
                byId[placeItem.id] = placeItem
                lastOrdered[placeItem.id] = max(lastOrdered[placeItem.id] ?? .distantPast, other.startedAt)
            }
        }
        return byId.values.sorted { (lastOrdered[$0.id] ?? .distantPast) > (lastOrdered[$1.id] ?? .distantPast) }
    }

    // MARK: - Ratings

    public static func rate(
        _ item: VisitItem, _ value: ItemRatingValue, for rateFor: RateFor,
        enteredBy: UUID?, origin: RatingOrigin = .tap, in context: ModelContext, now: Date = .now
    ) throws {
        guard let visit = item.visit, let place = visit.place else { return }
        try upsertRating(
            subjectType: .visitItem, subjectId: item.id, visitId: visit.id, placeId: place.id,
            valueRaw: value.rawValue, for: rateFor, enteredBy: enteredBy, origin: origin, in: context, now: now
        )
        item.modifiedAt = now
        try context.save()
        VisitSideEffects.reconcile(in: context)
    }

    public static func setVerdict(
        _ visit: Visit, _ value: VerdictValue, for rateFor: RateFor,
        enteredBy: UUID?, origin: RatingOrigin = .tap, in context: ModelContext, now: Date = .now
    ) throws {
        guard let place = visit.place else { return }
        try upsertRating(
            subjectType: .visit, subjectId: visit.id, visitId: visit.id, placeId: place.id,
            valueRaw: value.rawValue, for: rateFor, enteredBy: enteredBy, origin: origin, in: context, now: now
        )
        visit.modifiedAt = now
        try context.save()
        VisitSideEffects.reconcile(in: context)
    }

    /// Live ratings for one subject (a visit or a visit item).
    public static func ratings(for subjectId: UUID, in context: ModelContext) throws -> [Rating] {
        try context.fetch(FetchDescriptor<Rating>(predicate: #Predicate { $0.subjectId == subjectId && $0.deletedAt == nil }))
    }

    /// "Joint unless we disagree" for a dish.
    public static func display(
        for item: VisitItem, household: [UUID], in context: ModelContext
    ) throws -> RatingDisplay<ItemRatingValue> {
        try display(subjectId: item.id, household: household, in: context, as: ItemRatingValue.self)
    }

    /// "Joint unless we disagree" for a visit verdict.
    public static func verdict(
        for visit: Visit, household: [UUID], in context: ModelContext
    ) throws -> RatingDisplay<VerdictValue> {
        try display(subjectId: visit.id, household: household, in: context, as: VerdictValue.self)
    }

    /// The value currently recorded for exactly this scope (to highlight the tapped button).
    public static func recordedValue(for subjectId: UUID, rateFor: RateFor, in context: ModelContext) throws -> String? {
        try ratings(for: subjectId, in: context).first { matches($0, rateFor) }?.valueRaw
    }

    /// Household participants of the visit (Ted, Lori) — whose opinions count for joint/split.
    public static func household(for visit: Visit, people: [Person]) -> [UUID] {
        let householdIds = Set(people.filter { $0.kind == .household && $0.deletedAt == nil }.map(\.id))
        return visit.participantIds.filter { householdIds.contains($0) }
    }

    // MARK: - Private

    private static func display<V: RawRepresentable & Hashable & Sendable>(
        subjectId: UUID, household: [UUID], in context: ModelContext, as type: V.Type
    ) throws -> RatingDisplay<V> where V.RawValue == String {
        display(try ratings(for: subjectId, in: context), household: household, as: type)
    }

    /// "Joint unless we disagree" over already-fetched live ratings for one subject.
    public static func display<V: RawRepresentable & Hashable & Sendable>(
        _ ratings: [Rating], household: [UUID], as: V.Type
    ) -> RatingDisplay<V> where V.RawValue == String {
        let inputs: [RatingInput<V>] = ratings.filter { $0.deletedAt == nil }.compactMap { rating in
            guard let value = V(rawValue: rating.valueRaw) else { return nil }
            return RatingInput(scope: rating.scope, personId: rating.personId?.uuidString, value: value)
        }
        switch displayRating(inputs, household: household.map(\.uuidString)) {
        case .none: return .none
        case .joint(let value): return .joint(value)
        case .split(let people): return .split(people)
        }
    }

    private static func matches(_ rating: Rating, _ rateFor: RateFor) -> Bool {
        switch rateFor {
        case .us: rating.scope == .joint
        case .person(let id): rating.scope == .person && rating.personId == id
        }
    }

    private static func upsertRating(
        subjectType: RatingSubjectType, subjectId: UUID, visitId: UUID, placeId: UUID,
        valueRaw: String, for rateFor: RateFor, enteredBy: UUID?, origin: RatingOrigin, in context: ModelContext, now: Date
    ) throws {
        // Include tombstoned ratings so a re-rating revives the same record (unique per scope).
        let all = try context.fetch(FetchDescriptor<Rating>(predicate: #Predicate { $0.subjectId == subjectId }))
        if let existing = all.first(where: { matches($0, rateFor) }) {
            existing.valueRaw = valueRaw
            existing.enteredByPersonId = enteredBy
            existing.originRaw = origin.rawValue
            existing.deletedAt = nil
            existing.modifiedAt = now
            return
        }
        let personId: UUID? = if case .person(let id) = rateFor { id } else { nil }
        context.insert(Rating(
            subjectType: subjectType, subjectId: subjectId, visitId: visitId, placeId: placeId,
            scope: personId == nil ? .joint : .person, personId: personId, valueRaw: valueRaw,
            enteredByPersonId: enteredBy, origin: origin, now: now
        ))
    }

    private static func placeItem(named name: String, at place: Place, source: String, in context: ModelContext, now: Date) -> PlaceItem {
        let normalized = normalizeItemName(name)
        if let existing = place.items.first(where: { $0.normalizedName == normalized && $0.deletedAt == nil }) {
            if !existing.sources.contains(source) { existing.sources.append(source) }
            return existing
        }
        let item = PlaceItem(place: place, name: name, source: source, now: now)
        context.insert(item)
        return item
    }

    private static func nextSortOrder(_ visit: Visit) -> Int {
        (visit.items.map(\.sortOrder).max() ?? -1) + 1
    }
}
