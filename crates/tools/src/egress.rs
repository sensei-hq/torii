//! SSRF egress filter for `http`/`sse` MCP transports.
//!
//! Every central-plane tool connection is vetted here **before a socket opens**: the scheme is
//! allow-listed, the host is resolved, and the connection is **pinned to a vetted IP** so a
//! later re-resolution (DNS rebind) can't swing it to a private address. Any resolved IP in a
//! denied range (loopback, link-local/cloud-metadata `169.254.169.254`, private, CGNAT,
//! reserved, IPv4-mapped-in-IPv6) rejects the whole target — we never cherry-pick a public A
//! record out of a mixed set. The deny table is deliberately explicit and unit-tested rather
//! than trusting a single `std` predicate.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use url::Url;

use crate::error::ToolError;

/// A host resolved + vetted to one IP the connection is **pinned** to. The transport MUST
/// connect to `ip` (not re-resolve `host`) and send `Host: host` — this is what defeats rebind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PinnedTarget {
    pub url: Url,
    pub host: String,
    pub port: u16,
    pub ip: IpAddr,
}

/// Injectable DNS resolver so the SSRF policy is fully unit-testable without real DNS (and so
/// the transport can pin the exact IP it vetted).
pub trait Resolver: Send + Sync {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ToolError>;
}

/// The real system DNS resolver. NB: `to_socket_addrs` is blocking — acceptable on the
/// infrequent admin-triggered discovery path; a non-blocking resolver is a tracked follow-up.
pub struct StdResolver;

impl Resolver for StdResolver {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ToolError> {
        use std::net::ToSocketAddrs;
        let addrs = (host, 0u16)
            .to_socket_addrs()
            .map_err(|e| ToolError::Ssrf(format!("dns resolution failed for '{host}': {e}")))?;
        Ok(addrs.map(|s| s.ip()).collect())
    }
}

/// Egress policy knobs. Defaults are the safe production posture.
#[derive(Debug, Clone)]
pub struct EgressPolicy {
    /// LOCAL DEV ONLY: permit plaintext `http` and connections to otherwise-blocked ranges
    /// (e.g. a `localhost` MCP server). MUST be false in production.
    pub allow_insecure: bool,
    /// Redirect hops the caller may follow (each hop is re-checked by the transport).
    pub max_redirects: u8,
}

impl Default for EgressPolicy {
    fn default() -> Self {
        Self {
            allow_insecure: false,
            max_redirects: 3,
        }
    }
}

/// Is an IPv4 address in a range we must never let a tool reach?
pub fn is_blocked_ipv4(ip: &Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_loopback()            // 127.0.0.0/8
        || ip.is_private()      // 10/8, 172.16/12, 192.168/16
        || ip.is_link_local()   // 169.254.0.0/16 (incl. cloud metadata 169.254.169.254)
        || ip.is_unspecified()  // 0.0.0.0
        || ip.is_broadcast()    // 255.255.255.255
        || ip.is_documentation()// 192.0.2/24, 198.51.100/24, 203.0.113/24
        || o[0] == 0                                   // 0.0.0.0/8 "this network"
        || (o[0] == 100 && (o[1] & 0xC0) == 64)        // 100.64.0.0/10 CGNAT
        || (o[0] == 198 && (o[1] & 0xFE) == 18)        // 198.18.0.0/15 benchmarking
        || o[0] >= 240                                 // 240.0.0.0/4 reserved
}

/// Is an IP in a denied range? IPv4-in-IPv6 forms are unwrapped and re-checked (a classic
/// bypass): `::ffff:169.254.169.254` and `::169.254.169.254` both resolve to the v4 check.
pub fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_ipv4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ipv4(&v4);
            }
            // `to_ipv4()` also catches the deprecated `::a.b.c.d` compat form.
            if let Some(v4) = v6.to_ipv4() {
                return is_blocked_ipv4(&v4);
            }
            is_blocked_ipv6(v6)
        }
    }
}

fn is_blocked_ipv6(ip: &Ipv6Addr) -> bool {
    ip.is_loopback()                              // ::1
        || ip.is_unspecified()                    // ::
        || (ip.segments()[0] & 0xFE00) == 0xFC00  // fc00::/7 unique-local
        || (ip.segments()[0] & 0xFFC0) == 0xFE80  // fe80::/10 link-local
}

/// Vets `http`/`sse` egress and pins a safe IP.
pub struct EgressFilter<R: Resolver> {
    resolver: R,
    policy: EgressPolicy,
}

impl<R: Resolver> EgressFilter<R> {
    pub fn new(resolver: R, policy: EgressPolicy) -> Self {
        Self { resolver, policy }
    }

    /// Vet a URL and return the IP-pinned target to connect to, or an SSRF rejection.
    ///
    /// Order: scheme allow-list → resolve (literal IP short-circuits DNS) → reject if **any**
    /// resolved IP is blocked → pin the first IP. The caller connects to `PinnedTarget.ip`.
    pub fn check(&self, raw: &str) -> Result<PinnedTarget, ToolError> {
        let url = Url::parse(raw).map_err(|e| ToolError::Ssrf(format!("invalid url: {e}")))?;
        match url.scheme() {
            "https" => {}
            "http" if self.policy.allow_insecure => {}
            other => {
                return Err(ToolError::Ssrf(format!(
                    "scheme '{other}' not permitted (https only)"
                )))
            }
        }
        let host = url
            .host_str()
            .ok_or_else(|| ToolError::Ssrf("url has no host".into()))?
            .to_string();
        let port = url
            .port_or_known_default()
            .ok_or_else(|| ToolError::Ssrf("url has no port".into()))?;

        // A literal IP host is checked directly (no DNS); otherwise resolve.
        let ips: Vec<IpAddr> = match host.parse::<IpAddr>() {
            Ok(ip) => vec![ip],
            Err(_) => self.resolver.resolve(&host)?,
        };
        if ips.is_empty() {
            return Err(ToolError::Ssrf(format!("host '{host}' did not resolve")));
        }
        // Reject the whole target if ANY resolved IP is blocked — an attacker can't smuggle a
        // private A-record alongside a public one. (Local dev may opt out via allow_insecure.)
        if !self.policy.allow_insecure {
            if let Some(bad) = ips.iter().find(|ip| is_blocked_ip(ip)) {
                return Err(ToolError::Ssrf(format!(
                    "host '{host}' resolves to a blocked address ({bad})"
                )));
            }
        }
        // Pin the first resolved IP — the transport connects to THIS, never a re-resolution.
        Ok(PinnedTarget {
            url,
            host,
            port,
            ip: ips[0],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct StaticResolver(HashMap<String, Vec<IpAddr>>);
    impl Resolver for StaticResolver {
        fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, ToolError> {
            Ok(self.0.get(host).cloned().unwrap_or_default())
        }
    }
    fn resolver(pairs: &[(&str, &[&str])]) -> StaticResolver {
        StaticResolver(
            pairs
                .iter()
                .map(|(h, ips)| {
                    (
                        h.to_string(),
                        ips.iter().map(|s| s.parse().unwrap()).collect(),
                    )
                })
                .collect(),
        )
    }
    fn prod<R: Resolver>(r: R) -> EgressFilter<R> {
        EgressFilter::new(r, EgressPolicy::default())
    }

    #[test]
    fn blocks_cloud_metadata_link_local_loopback_private_cgnat_reserved() {
        for ip in [
            "169.254.169.254", // AWS/GCP metadata
            "169.254.0.1",     // link-local
            "127.0.0.1",       // loopback
            "127.5.5.5",       // 127/8
            "10.0.0.5",        // private
            "172.16.0.1",      // private
            "192.168.1.1",     // private
            "100.64.0.1",      // CGNAT
            "0.0.0.0",         // unspecified
            "198.18.0.1",      // benchmarking
            "240.0.0.1",       // reserved
            "255.255.255.255", // broadcast
        ] {
            assert!(is_blocked_ip(&ip.parse().unwrap()), "{ip} must be blocked");
        }
    }

    #[test]
    fn allows_ordinary_public_addresses() {
        for ip in ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(!is_blocked_ip(&ip.parse().unwrap()), "{ip} should be allowed");
        }
    }

    #[test]
    fn blocks_ipv4_mapped_ipv6_bypass() {
        // the classic bypass: private/metadata v4 tunnelled through a v6 form.
        for ip in ["::ffff:127.0.0.1", "::ffff:169.254.169.254", "::1", "fe80::1", "fc00::1"] {
            assert!(is_blocked_ip(&ip.parse().unwrap()), "{ip} must be blocked");
        }
    }

    #[test]
    fn check_rejects_literal_metadata_ip_before_dns() {
        let f = prod(resolver(&[]));
        let err = f.check("https://169.254.169.254/latest/meta-data").unwrap_err();
        assert!(matches!(err, ToolError::Ssrf(_)));
    }

    #[test]
    fn check_rejects_host_resolving_to_metadata() {
        let f = prod(resolver(&[("evil.example", &["169.254.169.254"])]));
        assert!(f.check("https://evil.example/x").is_err());
    }

    #[test]
    fn check_rejects_mixed_public_and_private_resolution() {
        // a public + private A-record set must reject wholesale (no cherry-picking the public).
        let f = prod(resolver(&[("mix.example", &["93.184.216.34", "10.0.0.5"])]));
        assert!(f.check("https://mix.example/x").is_err());
    }

    #[test]
    fn check_rejects_plaintext_http_in_prod() {
        let f = prod(resolver(&[("ok.example", &["93.184.216.34"])]));
        let err = f.check("http://ok.example/x").unwrap_err();
        assert!(matches!(err, ToolError::Ssrf(_)));
    }

    #[test]
    fn check_pins_the_resolved_public_ip() {
        let f = prod(resolver(&[("ok.example", &["93.184.216.34"])]));
        let t = f.check("https://ok.example/mcp").unwrap();
        // the transport must connect to this exact pinned IP (rebind defence), not re-resolve.
        assert_eq!(t.ip, "93.184.216.34".parse::<IpAddr>().unwrap());
        assert_eq!(t.host, "ok.example");
        assert_eq!(t.port, 443);
    }

    #[test]
    fn insecure_dev_policy_permits_localhost() {
        let f = EgressFilter::new(
            resolver(&[("localhost", &["127.0.0.1"])]),
            EgressPolicy {
                allow_insecure: true,
                ..Default::default()
            },
        );
        assert!(f.check("http://localhost:8931/mcp").is_ok());
    }
}
