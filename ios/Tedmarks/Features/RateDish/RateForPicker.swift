import SwiftUI
import TedmarksKit

/// "Us / Ted / Lori / Sam": who the next tap rates for — a segment per person here, guests too.
/// Us = a joint rating.
struct RateForPicker: View {
    @Binding var selection: RateFor
    let raters: [Person]

    var body: some View {
        if raters.count > 1 {
            Picker("Rate for", selection: $selection) {
                Text("Us").tag(RateFor.us)
                ForEach(raters) { person in
                    Text(person.displayName).tag(RateFor.person(person.id))
                }
            }
            .pickerStyle(.segmented)
        }
    }
}
