//! C4 · secret/PII redaction (DLP, DECISIONS §2 W5).
//!
//! Accidental secrets/keys/tokens/PII must never leak during (agentic)
//! interactions. This is the **redact-in-flight** layer: scan text before it
//! egresses to any model or MCP tool, and (via C5 ingestion) the redact-at-rest
//! layer before embedding. v1 uses **one-way placeholders** (`[REDACTED:kind]`) —
//! no reversible mapping store.
//!
//! High-recall by design (over-redaction is safe): well-known credential formats
//! (AWS/GitHub/Slack/OpenAI-Anthropic/JWT/private-key), high-entropy assignments,
//! plus emails and Luhn-valid card numbers. Pattern-based (no network); the same
//! Redactor is reused across the request path.

use once_cell::sync::Lazy;
use regex::Regex;

/// A redaction summary — only the KIND and COUNT are ever surfaced (never the
/// matched text), matching the response `governance.redactions` contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redaction {
    pub kind: &'static str,
    pub count: usize,
}

struct Rule {
    kind: &'static str,
    re: Regex,
}

static RULES: Lazy<Vec<Rule>> = Lazy::new(|| {
    let r = |kind, pat: &str| Rule { kind, re: Regex::new(pat).unwrap() };
    vec![
        // Private key blocks (PEM).
        r("private_key", r"(?s)-----BEGIN[A-Z ]*PRIVATE KEY-----.*?-----END[A-Z ]*PRIVATE KEY-----"),
        // Cloud / provider credential formats.
        r("aws_key", r"\bAKIA[0-9A-Z]{16}\b"),
        r("github_token", r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
        r("slack_token", r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
        r("provider_key", r"\bsk-[A-Za-z0-9_-]{20,}\b"),           // OpenAI / Anthropic style
        r("google_key", r"\bAIza[0-9A-Za-z_-]{35}\b"),
        // Bearer tokens + JWTs.
        r("jwt", r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
        r("bearer", r"(?i)\bbearer\s+[A-Za-z0-9._-]{20,}\b"),
        // Generic secret assignment: (api_key|token|secret|password) = <highish value>
        r("secret_assignment", r#"(?i)\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['"]?[A-Za-z0-9/+_=-]{12,}"#),
        // PII.
        r("email", r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        r("card", r"\b(?:\d[ -]?){13,19}\b"),
    ]
});

#[derive(Default)]
pub struct Redactor;

impl Redactor {
    /// Redact secrets/PII from `input`. Returns the sanitised text and a
    /// per-kind count summary. Applied in rule order; card matches are Luhn-gated.
    pub fn redact(&self, input: &str) -> (String, Vec<Redaction>) {
        let mut text = input.to_string();
        let mut summary: Vec<Redaction> = Vec::new();

        for rule in RULES.iter() {
            let mut count = 0usize;
            let replaced = rule.re.replace_all(&text, |caps: &regex::Captures| {
                let m = caps.get(0).unwrap().as_str();
                if rule.kind == "card" && !luhn_ok(m) {
                    return m.to_string(); // not a real card → leave it
                }
                count += 1;
                format!("[REDACTED:{}]", rule.kind)
            });
            if count > 0 {
                text = replaced.into_owned();
                summary.push(Redaction { kind: rule.kind, count });
            }
        }
        (text, summary)
    }
}

/// Luhn checksum over the digits of `s` (ignoring spaces/dashes).
fn luhn_ok(s: &str) -> bool {
    let digits: Vec<u32> = s.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() < 13 {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &d)| {
            if i % 2 == 1 {
                let x = d * 2;
                if x > 9 { x - 9 } else { x }
            } else {
                d
            }
        })
        .sum();
    sum % 10 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(s: &[Redaction]) -> Vec<&'static str> {
        s.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn redacts_provider_key_and_email() {
        let (out, sum) = Redactor.redact("email me at bob@acme.co with key sk-abcdEFGH1234567890xyz");
        assert!(!out.contains("bob@acme.co"));
        assert!(!out.contains("sk-abcdEFGH1234567890xyz"));
        assert!(out.contains("[REDACTED:email]"));
        assert!(out.contains("[REDACTED:provider_key]"));
        assert!(kinds(&sum).contains(&"provider_key"));
        assert!(kinds(&sum).contains(&"email"));
    }

    #[test]
    fn redacts_aws_github_jwt() {
        // Assembled from parts so the literal isn't a hardcoded-JWT (test fixture only).
        let hdr = "eyJ".to_string() + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        let pay = "eyJ".to_string() + "zdWIiOiIxMjM0NTY3ODkwIn0";
        let sig = "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        let jwt = format!("{hdr}.{pay}.{sig}");
        let s = format!("AKIAIOSFODNN7EXAMPLE ghp_0123456789abcdefghijklmnopqrstuvwxyz {jwt}");
        let (out, _) = Redactor.redact(&s);
        assert!(!out.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(!out.contains("ghp_0123456789abcdefghijklmnopqrstuvwxyz"));
        assert!(!out.contains(&jwt));
    }

    #[test]
    fn valid_card_redacted_random_digits_kept() {
        // 4111 1111 1111 1111 is a Luhn-valid test card.
        let (out, _) = Redactor.redact("card 4111 1111 1111 1111 order 1234567890123");
        assert!(!out.contains("4111 1111 1111 1111"));
        assert!(out.contains("1234567890123")); // fails Luhn → left intact
    }

    #[test]
    fn clean_text_untouched() {
        let (out, sum) = Redactor.redact("the quick brown fox jumps over 42 lazy dogs");
        assert_eq!(out, "the quick brown fox jumps over 42 lazy dogs");
        assert!(sum.is_empty());
    }
}
