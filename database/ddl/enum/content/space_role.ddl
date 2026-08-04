-- database/ddl/enum/content/space_role.ddl
set search_path to content;
-- db-redesign.md §3 content enum: space_members.role (a member's role within a space). Zero code
-- sites today — the gateway never inserts space_members nor reads role (space-ACL checks are
-- space_id/profile_id EXISTS subqueries; a role-gate is a deferred refinement). Pure DDL swap.
create type space_role as enum ('owner', 'editor', 'viewer', 'member');
