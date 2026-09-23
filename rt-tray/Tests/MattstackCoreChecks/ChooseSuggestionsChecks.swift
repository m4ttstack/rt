import Foundation
import MattstackCore

let chooseSuggestionsChecks: [Check] = [
    Check("ChooseSuggestions.matching: empty or whitespace-only input yields nothing") { c in
        c.expectEqual(ChooseSuggestions.matching("", in: ["x:y", "team-voice"]), [])
        c.expectEqual(ChooseSuggestions.matching("   ", in: ["x:y", "team-voice"]), [])
    },
    Check("ChooseSuggestions.matching: case-insensitive, prefix matches before contains matches, each group keeps input order") { c in
        let all = ["team:writing-style", "matt:writing-style", "x:writing", "writing-team"]
        c.expectEqual(ChooseSuggestions.matching("writing", in: all), ["writing-team", "team:writing-style", "matt:writing-style", "x:writing"])
        c.expectEqual(ChooseSuggestions.matching("WRITING", in: all), ["writing-team", "team:writing-style", "matt:writing-style", "x:writing"])
    },
    Check("ChooseSuggestions.matching: drops an id exactly equal to the input") { c in
        c.expectEqual(ChooseSuggestions.matching("team-voice", in: ["team-voice", "team-voice-2"]), ["team-voice-2"])
        c.expectEqual(ChooseSuggestions.matching("Team-Voice", in: ["team-voice", "team-voice-2"]), ["team-voice-2"])
    },
    Check("ChooseSuggestions.matching: returns every match, uncapped") { c in
        let all = (1...7).map { "acme:skill-\($0)" }
        c.expectEqual(ChooseSuggestions.matching("acme:", in: all), all)
    },
    Check("ChooseSuggestions.matching: trims the input before matching") { c in
        c.expectEqual(ChooseSuggestions.matching("  team  ", in: ["team-voice"]), ["team-voice"])
    },
]
