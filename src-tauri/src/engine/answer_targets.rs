/// One answer target parsed from a trailing marker like `[N]` or `[N mol]`.
#[derive(Debug, Clone, PartialEq)]
pub struct AnswerTarget {
    pub symbol: String,
    pub unit: Option<String>,
}

/// Extract answer-target symbols and optional units from the trailing
/// `[SYMBOL]` or `[SYMBOL UNIT]` block at the end of the question text,
/// e.g. "... [N mol][M g]" -> [{symbol: "N", unit: Some("mol")}, ...].
/// The markers are returned in the order they appear left-to-right.
pub fn extract_target_symbols(text: &str) -> Vec<AnswerTarget> {
    let trimmed = text.trim();
    let mut targets = Vec::new();
    let mut i = trimmed.len();
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
        }

        let trailing = before[..open].trim_end();
        if trailing.is_empty() {
            break;
        }
        i = trailing.len();
    }
    targets.reverse();
    targets
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
}
