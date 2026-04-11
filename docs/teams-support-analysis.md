# Atlassian Teams Support — Analysis & Implementation Plan

Status: **Blocked** — waiting for Teamwork Graph API to exit EAP
Date: 2026-04-11

## Motivation

The Forge `UserPicker` component with `isMulti` shows both users and teams in its dropdown. Users expect to select a team and have all team members authorized to sign. Currently only individual users (`config.signers`) and Atlassian groups (`config.signerGroups`) are supported.

Atlassian Teams are organization-level collaboration constructs, distinct from Confluence groups. Teams are managed in the Atlassian People directory, not in Confluence admin. It is likely that Teams will supersede groups as Atlassian's primary organizational unit.

## API: Teamwork Graph (EAP)

The only Forge-native API for resolving team membership is `api.asUser().requestTeamworkGraph()`.

- Uses Cypher queries wrapped in GraphQL
- Relationship: `user_is_in_team` connects `IdentityUser` to `IdentityTeam`
- Required scope: `read:graph:confluence`
- **Currently in Early Access Program (EAP)** — unsupported, subject to change without notice

### Cypher queries

Check if user X is in team Y (for authorization):
```cypher
MATCH (user:IdentityUser {ari: $userAri})-[:user_is_in_team]->(team:IdentityTeam {ari: $teamAri})
RETURN user
```

Get all members of team Y (for pending signers):
```cypher
MATCH (user:IdentityUser)-[:user_is_in_team]->(team:IdentityTeam {ari: $teamAri})
RETURN collect(distinct user) as members
```

### ARI format

- User: `ari:cloud:identity::user/<accountId>`
- Team: `ari:cloud:identity::team/<teamId>`

## Why we're waiting

Atlassian's EAP terms state:
- "unsupported and subject to change without notice"
- "must only install apps in test organizations"

Shipping a production Marketplace app on an EAP API means:
1. Violating the EAP terms of use
2. Risk of silent breakage if Atlassian changes the API (query format, ARI format, response schema, or scope requirements)
3. No migration path guaranteed — customers who configure team-based signers would see "Authorization check failed" if the API changes
4. No Atlassian support if issues arise

The feature is well-understood and ready to implement. When the API goes GA, it's a straightforward addition.

## Implementation plan

### Config changes

New field: `config.signerTeams: string[]` (array of Atlassian team IDs)

Stored separately from `signers` (account IDs) and `signerGroups` (group IDs). The UserPicker `onChange` returns `{id, type}` where `type` is `"user"` or `"team"` — partition by type at submission time.

### Authorization flow

Insert team check as step 5.5 in `src/utils/signatureAuthorization.js`, between group membership (step 5) and page permissions (step 6):

```
1. Check maxSignatures
2. Check already signed
3. Petition mode (no restrictions) — add signerTeams to condition
4. Named signers (config.signers)
5. Group membership (config.signerGroups) — via Confluence REST API
5.5. Team membership (config.signerTeams) — via Teamwork Graph API  ← NEW
6. Page permissions (inheritViewers / inheritEditors)
7. Default deny
```

Use `isUserInTeam(accountId, teamId)` for authorization (one query per team, more efficient than fetching all members).

### Pending signers

In `src/resolvers/getPendingSignersResolver.js`, add team member resolution after group resolution (step 2), before page permissions (step 3):

Use `getTeamMembers(teamId)` to fetch all members, add to `authorizedUsers` set. Error handling: log and skip (matching existing group failure pattern).

### Files to modify

| File | Change |
|------|--------|
| `manifest.yml` | Add `read:graph:confluence` scope |
| `src/utils/teamworkGraphClient.js` | **New** — `isUserInTeam()` and `getTeamMembers()` |
| `src/utils/signatureAuthorization.js` | Add team check (step 5.5), update petition mode condition |
| `src/resolvers/getPendingSignersResolver.js` | Add team members to authorized set, update petition mode |
| `src/frontend/config.jsx` | Separate users from teams in UserPicker onChange/submit |
| `src/shared/normalizeLegacyConfig.js` | Default `signerTeams` to `[]` |
| `src/i18n/*.json` | Update signers description |
| `docs/signature-authorization.md` | Add teams to spec |

### Scope impact

Adding `read:graph:confluence` forces all existing installations to re-approve permissions on next deploy. This should be communicated in release notes.

### Known limitations

- **No pagination** in Teamwork Graph Cypher results — `collect()` returns all at once. Very large teams (1000+ members) may hit response size limits.
- **ARI format** needs verification — the `ari:cloud:identity::` prefix is assumed from documentation examples.
- The `getTeamMembers` response requires parsing `IdentityUser` objects and extracting accountIds from ARIs.

## References

- [Forge Teamwork Graph API](https://developer.atlassian.com/platform/forge/teamwork-graph/)
- [Atlassian Teams REST API](https://developer.atlassian.com/cloud/teams/)
- [Forge EAP Terms](https://developer.atlassian.com/platform/forge/eap-terms/)
