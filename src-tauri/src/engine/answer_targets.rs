/// One answer target parsed from a trailing marker like `[N]` or `[N mol]`.
#[derive(Debug, Clone, PartialEq)]
pub struct AnswerTarget {
    pub symbol: String,
    pub unit: Option<String>,
}

/// Scan the trailing `[SYMBOL]` / `[SYMBOL UNIT]` marker block, returning the
/// parsed targets (left-to-right) together with the byte offset — into the
/// *trimmed* text — at which that block begins.
///
/// Both [`extract_target_symbols`] and [`strip_answer_targets`] are built on
/// this so the set of markers the generator treats as answer targets can
/// never drift from the set the renderers hide from students.
fn scan_targets(trimmed: &str) -> (Vec<AnswerTarget>, usize) {
    let mut targets = Vec::new();
    let mut i = trimmed.len();
    let mut block_start = trimmed.len();
    while i > 0 {
        let before = &trimmed[..i];
        let Some(open) = before.rfind('[') else {
            break;
        };
        if open + 1 >= i || before.as_bytes().get(i - 1) != Some(&b']') {
            break;
        }
        let inner = &before[open + 1..i - 1];
        if inner.is_empty() || inner.contains('[') || inner.contains(']') {
            break;
        }

        let inner = inner.trim();
        let mut parts = inner.splitn(2, char::is_whitespace);
        let symbol = parts.next().unwrap_or("").to_string();
        let unit = parts.next().map(|u| u.to_string());
        if !symbol.is_empty() {
            targets.push(AnswerTarget { symbol, unit });
            block_start = open;
        }

        let trailing = before[..open].trim_end();
        if trailing.is_empty() {
            break;
        }
        i = trailing.len();
    }
    targets.reverse();
    (targets, block_start)
}

/// Extract answer-target symbols and optional units from the trailing
/// `[SYMBOL]` or `[SYMBOL UNIT]` block at the end of the question text,
/// e.g. "... [N mol][M g]" -> [{symbol: "N", unit: Some("mol")}, ...].
/// The markers are returned in the order they appear left-to-right.
pub fn extract_target_symbols(text: &str) -> Vec<AnswerTarget> {
    scan_targets(text.trim()).0
}

/// The question text as a student should see it: the trailing answer-target
/// markers are an instruction to the generator (which symbol to solve for),
/// never part of the question, so they must not appear in exported tests or
/// anywhere in the UI.
pub fn strip_answer_targets(text: &str) -> &str {
    let trimmed = text.trim();
    let (_, block_start) = scan_targets(trimmed);
    trimmed[..block_start].trim_end()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_marker() {
        let targets = extract_target_symbols("Vypočítejte [N]");
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].symbol, "N");
        assert_eq!(targets[0].unit, None);
    }

    #[test]
    fn parses_marker_with_unit() {
        let targets = extract_target_symbols("Vypočítejte [n mol][m g]");
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].symbol, "n");
        assert_eq!(targets[0].unit, Some("mol".to_string()));
        assert_eq!(targets[1].symbol, "m");
        assert_eq!(targets[1].unit, Some("g".to_string()));
    }

    #[test]
    fn returns_empty_without_markers() {
        let targets = extract_target_symbols("Vypočítejte [[V]]");
        assert!(targets.is_empty());
    }

    #[test]
    fn strips_trailing_marker() {
        assert_eq!(
            strip_answer_targets(
                "Vypočítejte látkové množství Ca^2+ v [[m]] g Ca(HSO_3)_2. [n]"
            ),
            "Vypočítejte látkové množství Ca^2+ v [[m]] g Ca(HSO_3)_2."
        );
    }

    #[test]
    fn strips_multiple_trailing_markers_with_units() {
        assert_eq!(
            strip_answer_targets("Vypočítejte obojí [n mol][m g]"),
            "Vypočítejte obojí"
        );
    }

    #[test]
    fn leaves_double_bracket_placeholders_alone() {
        assert_eq!(
            strip_answer_targets("Vypočítejte pro objem [[V]]"),
            "Vypočítejte pro objem [[V]]"
        );
    }

    #[test]
    fn leaves_text_without_markers_alone() {
        assert_eq!(
            strip_answer_targets("Vypočítejte hmotnost roztoku."),
            "Vypočítejte hmotnost roztoku."
        );
    }

    /// Only the *trailing* block is a marker — a bracketed aside in the middle
    /// of a sentence is part of the question and must survive.
    #[test]
    fn leaves_non_trailing_brackets_alone() {
        assert_eq!(
            strip_answer_targets("Vypočítejte [pozor] hmotnost [m]"),
            "Vypočítejte [pozor] hmotnost"
        );
    }

    /// Stripping and extraction must always agree about what counts as a
    /// marker, otherwise a symbol could be solved for but still shown.
    #[test]
    fn strip_and_extract_agree() {
        for text in [
            "Vypočítejte [n]",
            "Vypočítejte [n mol][m g]",
            "Vypočítejte [[V]]",
            "Vypočítejte hmotnost.",
            "Vypočítejte [pozor] hmotnost [m]",
        ] {
            let stripped = strip_answer_targets(text);
            let targets = extract_target_symbols(text);
            // Whatever was removed must be exactly the markers that were parsed.
            assert!(
                text.trim().starts_with(stripped),
                "stripped text should be a prefix of the original: {text:?}"
            );
            if targets.is_empty() {
                assert_eq!(stripped, text.trim(), "nothing to strip in {text:?}");
            } else {
                assert!(
                    !stripped.ends_with(']'),
                    "markers should be gone from {text:?}, got {stripped:?}"
                );
            }
        }
    }
}
