import Foundation
import Testing
@testable import TedmarksKit

@Test func askMarkdownSplitsParagraphsListsAndHeadings() {
    let blocks = AskMarkdown.blocks("""
    Your best tacos were at **Taco Guild**:
    both of you loved the carnitas.

    ## Also good
    - Tacos Chiwas: *good*
      (al pastor)
    - Barrio Café
      - closed Mondays
    1. First
    2) Second
    """)
    #expect(blocks == [
        .paragraph("Your best tacos were at **Taco Guild**: both of you loved the carnitas."),
        .heading("Also good"),
        .listItem(marker: "•", text: "Tacos Chiwas: *good* (al pastor)", level: 0),
        .listItem(marker: "•", text: "Barrio Café", level: 0),
        .listItem(marker: "•", text: "closed Mondays", level: 1),
        .listItem(marker: "1.", text: "First", level: 0),
        .listItem(marker: "2.", text: "Second", level: 0),
    ])
}

@Test func askResponseDecodesWithPlaceIdsAsUUIDs() throws {
    let json = #"{"answer":"Try **Taco Guild**.","places":[{"id":"6f1c2c1e-6b7a-4a63-9a43-0c4b4f1c2d3e","name":"Taco Guild","city":"Phoenix"},{"id":"x","name":"Odd"}],"topics":[]}"#
    let response = try JSONDecoder().decode(AskResponse.self, from: Data(json.utf8))
    #expect(response.places.first?.uuid == UUID(uuidString: "6F1C2C1E-6B7A-4A63-9A43-0C4B4F1C2D3E"))
    #expect(response.places.first?.city == "Phoenix")
    #expect(response.places.last?.uuid == nil)
}
