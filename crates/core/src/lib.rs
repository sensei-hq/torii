//! Torii's shared Rust data layer (TM-8, torii#26).
//!
//! The API (`services/gateway`) and the operator CLI read torii's database through this crate
//! and nothing else, so they cannot drift into two implementations of "what the config is".

pub mod config;

pub use config::load_gateway_config;
