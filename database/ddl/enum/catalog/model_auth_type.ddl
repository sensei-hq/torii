-- database/ddl/enum/catalog/model_auth_type.ddl
set search_path to catalog;
-- G1 catalog enum: catalog.models.model_auth_type — how a MODEL is authenticated, used as a
-- tier-derivation input (e.g. a `premium-reasoning` tier derived by {auth=oauth_cli}).
-- Mirrors the gateway's `AuthType` {ApiKey, OauthCli, Keyless}.
--
-- NOT to be confused with the existing `catalog.auth_type` {api_key, aws_signature, oauth2,
-- bearer_token, custom, none}, which is the ROUTER's auth SCHEME on catalog.routers. Same
-- word, different concept and different variants — hence the `model_` prefix.
create type model_auth_type as enum ('api_key', 'oauth_cli', 'keyless');
