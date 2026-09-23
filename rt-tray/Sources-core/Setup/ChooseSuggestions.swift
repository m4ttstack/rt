import Foundation

/// Matches a typed skill id against the app's own suggestion list (the
/// contract's `other.suggestions`); the app never scans the filesystem.
public enum ChooseSuggestions {
    public static func matching(_ input: String, in all: [String]) -> [String] {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let needle = trimmed.lowercased()
        var prefixed: [String] = []
        var contained: [String] = []
        for id in all {
            let candidate = id.lowercased()
            guard candidate != needle else { continue }
            if candidate.hasPrefix(needle) { prefixed.append(id) }
            else if candidate.contains(needle) { contained.append(id) }
        }
        return prefixed + contained
    }
}
