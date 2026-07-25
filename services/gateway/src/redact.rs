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
        // Bearer / Basic auth headers + JWTs.
        r("jwt", r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
        r("bearer", r"(?i)\bbearer\s+[A-Za-z0-9._-]{20,}\b"),
        // HTTP Basic auth: `Authorization: Basic <base64(user:pass)>` (finding #5).
        r("basic_auth", r"(?i)\bauthorization\s*:\s*basic\s+[A-Za-z0-9+/=]{8,}"),
        // Generic secret assignment: (api_key|token|secret|password|…) = <highish value>.
        // The keyword is matched WITHOUT a leading word boundary and allows a
        // compound key suffix (`[A-Za-z0-9_]*`), so underscore-glued keys
        // (client_secret=, db_password=, aws_secret_access_key=, PRIVATE_KEY=) are
        // caught, not just bare keys (finding #4).
        r("secret_assignment", r#"(?i)(?:client[_-]?secret|secret[_-]?access[_-]?key|private[_-]?key|api[_-]?key|secret|token|password|passwd|pwd)[A-Za-z0-9_]*\s*[:=]\s*['"]?[A-Za-z0-9/+_=-]{12,}"#),
        // PII.
        r("email", r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
        // Card / PAN: 13-19 digits with optional space/dot/dash/whitespace
        // separators; trailing boundary relaxed so glued/newline PANs are caught.
        // Luhn-gated below after stripping non-digits (finding #10).
        r("card", r"\b\d(?:[\s.-]?\d){12,18}"),
    ]
});

/// Minimum Shannon entropy (bits/char) for a long opaque token to be treated as
/// a secret (finding #5). Tuned to the 3.5-4.0 band: random base64/hex credential
/// material sits well above it, while ordinary words fall below (and never reach
/// the 20-char contiguous run the scanner requires). High-recall by design —
/// over-redaction of long opaque tokens is acceptable.
const ENTROPY_THRESHOLD: f64 = 3.5;

/// Contiguous opaque-token candidate for the entropy scanner (finding #5). The
/// 20-char minimum keeps ordinary prose words (which are space-separated and far
/// shorter) out of the scan entirely.
static ENTROPY_TOKEN: Lazy<Regex> = Lazy::new(|| Regex::new(r"[A-Za-z0-9+/=_-]{20,}").unwrap());

/// Shannon entropy in bits per character over the bytes of `s`.
fn shannon_entropy(s: &str) -> f64 {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return 0.0;
    }
    let mut counts = [0u32; 256];
    for &b in bytes {
        counts[b as usize] += 1;
    }
    let n = bytes.len() as f64;
    counts
        .iter()
        .filter(|&&c| c > 0)
        .map(|&c| {
            let p = c as f64 / n;
            -p * p.log2()
        })
        .sum()
}

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

        // Entropy pass (finding #5): redact long opaque tokens whose Shannon
        // entropy exceeds the threshold — raw AWS-style 40-char secrets and other
        // prefix-less high-entropy blobs the format rules above cannot anchor on.
        // Runs last so it never re-scans `[REDACTED:*]` placeholders (all < 20 chars).
        let mut ent_count = 0usize;
        let replaced = ENTROPY_TOKEN.replace_all(&text, |caps: &regex::Captures| {
            let m = caps.get(0).unwrap().as_str();
            if shannon_entropy(m) >= ENTROPY_THRESHOLD {
                ent_count += 1;
                "[REDACTED:high_entropy]".to_string()
            } else {
                m.to_string()
            }
        });
        if ent_count > 0 {
            text = replaced.into_owned();
            summary.push(Redaction { kind: "high_entropy", count: ent_count });
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

    #[test]
    fn redacts_underscore_compound_secret_keys() {
        // Finding #4: underscore-glued keys must still redact the value.
        for s in [
            "client_secret=aBcD1234EfGh5678IjKl",
            "db_password=Str0ngPassw0rdValue123",
            "aws_secret_access_key=wJalrXUtnFEMIK7MDENGbPxRfiCY0000",
            "PRIVATE_KEY=abcdefghijklmnop1234567890",
        ] {
            let (out, sum) = Redactor.redact(s);
            assert!(out.contains("[REDACTED:"), "expected redaction for {s:?}, got {out:?}");
            assert!(!sum.is_empty(), "expected a summary entry for {s:?}");
            // The literal secret value must not survive.
            let value = s.split('=').nth(1).unwrap();
            assert!(!out.contains(value), "secret value leaked for {s:?}: {out:?}");
        }
    }

    #[test]
    fn redacts_high_entropy_blob() {
        // Finding #5: a raw 40-char AWS-style secret with no recognisable prefix.
        let secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
        assert!(shannon_entropy(secret) >= ENTROPY_THRESHOLD);
        let (out, sum) = Redactor.redact(&format!("the value is {secret} ok"));
        assert!(!out.contains(secret), "high-entropy secret leaked: {out:?}");
        assert!(kinds(&sum).contains(&"high_entropy"));
    }

    #[test]
    fn redacts_basic_auth_header() {
        // Finding #5: HTTP Basic auth base64 blob (base64("user:pass")).
        let (out, sum) = Redactor.redact("Authorization: Basic dXNlcjpwYXNz");
        assert!(!out.contains("dXNlcjpwYXNz"), "basic-auth blob leaked: {out:?}");
        assert!(kinds(&sum).contains(&"basic_auth"));
    }

    #[test]
    fn redacts_dotted_card() {
        // Finding #10: Luhn-valid PAN with dot separators.
        let (out, _) = Redactor.redact("pay to 4111.1111.1111.1111 now");
        assert!(!out.contains("4111.1111.1111.1111"), "dotted PAN leaked: {out:?}");
        assert!(out.contains("[REDACTED:card]"));
    }

    #[test]
    fn normal_sentence_not_mangled() {
        // Sanity: the entropy scanner must not shred ordinary prose into gibberish.
        let s = "Please summarize the quarterly report and email the team by Friday afternoon.";
        let (out, sum) = Redactor.redact(s);
        assert_eq!(out, s, "clean prose was over-redacted: {out:?}");
        assert!(sum.is_empty());
    }
}
