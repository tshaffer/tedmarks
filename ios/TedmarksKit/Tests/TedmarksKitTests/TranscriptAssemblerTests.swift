import Testing
@testable import TedmarksKit

@Test func keepsEveryPhraseAcrossPauses() {
    var assembler = TranscriptAssembler()
    assembler.update("The")
    assembler.update("The burrata")
    assembler.update("The burrata was amazing")
    // Pause: iOS finishes the phrase…
    assembler.commit()
    assembler.update("Lori")
    assembler.update("Lori loved the pizza")
    #expect(assembler.text == "The burrata was amazing Lori loved the pizza")
    // …or silently starts its partial results over.
    assembler.update("Coming")
    assembler.update("Coming back")
    #expect(assembler.text == "The burrata was amazing Lori loved the pizza Coming back")
}

@Test func revisionsOfTheSamePhraseReplaceIt() {
    var assembler = TranscriptAssembler()
    assembler.update("the bratta was")
    assembler.update("The burrata was")      // same start, revised words
    assembler.update("The burrata")          // shorter but same start: still a revision
    #expect(assembler.text == "The burrata")
}
