import SwiftUI
import TedmarksKit

/// "Us / Ted / Lori": who the next tap rates for. Us = a joint rating.
struct RateForPicker: View {
    @Binding var selection: RateFor
    let household: [Person]

    var body: some View {
        if household.count > 1 {
            Picker("Rate for", selection: $selection) {
                Text("Us").tag(RateFor.us)
                ForEach(household) { person in
                    Text(person.displayName).tag(RateFor.person(person.id))
                }
            }
            .pickerStyle(.segmented)
        }
    }
}
