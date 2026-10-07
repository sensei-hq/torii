//! Torii's shared Rust data layer (TM-8, torii#26).
//!
//! The API (`services/gateway`) and the operator CLI read torii's database through this crate
//! and nothing else, so they cannot drift into two implementations of "what the config is" or
//! "where a tenant's runs live".

pub mod config;
pub mod events;
pub mod registry_dir;
pub mod results;
pub mod stores;

pub use config::load_gateway_config;
pub use stores::{connect, resolve_tenant, TenantStores};
