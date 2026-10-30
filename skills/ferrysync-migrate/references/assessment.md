# Assessment procedure

Read-only. Output: a table the user approves. Spend the effort here: a wrong spaces mapping or a wrong id strategy is expensive to undo.

## Step 1: find the data layer

Search the repo for how data moves today and list every entry point.

| Look for | Tells you |
| --- | --- |
| `fetch(`, `axios`, `ky`, an API client module | REST calls and their endpoints |
| `useQuery`, `useMutation`, `queryClient`, `useSWR` | TanStack Query or SWR usage and keys |
| `createSlice`, `configureStore`, `create(` (zustand), `createContext` | Client state that holds server data |
| `onSnapshot`, `getDocs`, `firebase/firestore` | Firestore reads and listeners |
| `supabase.from(`, `.channel(`, `.on('postgres_changes'` | Supabase queries and realtime |
| `schema.prisma`, `drizzle.config`, `migrations/`, `*.sql` | The database, ORM and migration tool |
| `getSession`, `auth(`, `jwt`, `middleware` | How the backend knows the user |
| Workers, cron, queues, webhooks writing the same tables | Other writers |

## Step 2: classify every table or collection

For each candidate dataset fill one row. A dataset is anything the UI reads or writes.

| Question | Why it matters | Decision |
| --- | --- | --- |
| Rows per user (typical and worst case) | The whole visible set is held in memory and scanned by queries. Thousands: fine. Hundreds of thousands: not for Ferry | sync, or stay on the API |
| Is it server-authoritative? (payments, inventory, quotas, anything the user must not see before the server approves) | Writes are optimistic on the device and rolled back on refusal | stay on the API |
| Do two people edit the same long text? | Ferry does not merge text | CRDT for that field, or accept last write wins |
| Counters and appended lists? | Concurrent updates of one field overwrite each other | model as rows: one per increment, one per item |
| Owner or shared? | Decides the space function | private, or a space (`project:<id>`, `team:<id>`, `org:<id>`) |
| Where is membership stored today? | Becomes `syncServer.spaces.addMember` calls (and `claimSpace` for spaces created on devices) | table to read, endpoint to call |
| Read and write permission differ by role? | Membership gives read and write. Finer rules go in `validate` using `actor` | hook plan |
| Id type | Devices create ids offline: strings (UUIDv7 via `createId()`) | `uuid`/`text` key as is, or migrate: on SQLite a table rebuild that keeps the old integer as `legacy_id` for old app versions ([adoption-code](adoption-code.md)) |
| How are deletes done? | A sync delete sets `deleted_at` (timestamp or boolean) on the mirror row | existing column, or add one |
| Other columns not in the schema | The mirror leaves them alone, so they need defaults | list NOT NULL without default |
| Derived or computed columns, triggers | Triggers on mirrored tables run inside sync's transactions and must not write synced data | list them |
| Large binary data (images, files) | Ferry rows are JSON | keep blobs in object storage, sync the URL/key |
| Device-only data (drafts, UI state, settings) | `localOnly` | device-only |
| Dates | JSON values only | ISO string or epoch number |
| Who else writes this table (admin tool, jobs, other services, old app versions)? | Writes outside sync are invisible to devices and later overwritten | route through `write` or `log` (`log` does not exist on the SQLite drivers: `write` only) |
| Does the old API check roles on each write? | Routing an endpoint through `write` as the user enforces space membership and `validate`. If the legacy PATCH or DELETE had no role check, this is a tightening: other users who could edit a row through the old API now get `forbidden`. A decision to flag to the user, not to make | keep as is, or port the old rule, or accept the tightening |
| Does the old code hard delete or read deleted rows? | A delete through sync sets `deleted_at` (`deletedAt: false` really deletes). Every legacy read, join, count and report must filter `deleted_at IS NULL`, and `DELETE` endpoints become soft deletes | list the queries to change |

## Step 3: identity and auth

| Question | Notes |
| --- | --- |
| What identifies a request? | Cookie session, bearer JWT, API key. `auth(request)` gets the raw `Request` |
| Is the user id stable? | It names the private space and memberships. Use the primary key or the provider's `sub`, never an email. If a person can have two ids, map to one before returning |
| Anonymous use today? | Start on `local()` and `connect(..., { upload: true })` at sign-in |
| Several accounts on one device? | Sign-out must wipe: `sync.reset(local())`. A device belongs to the first user who syncs with it (403 otherwise) |

## Step 4: rules to port

List every permission check and validation today (endpoint code, RLS policies, Firestore rules, client checks). For each: is it covered by "member of the space may read and write"? If not, it is a `validate` hook (refuse with a code), an invite endpoint that calls `addMember`, or an `onWrite` side effect. Rules that cannot run inside a database transaction quickly (calling a payment API) are not `validate` material: keep that flow on the API.

## Step 5: output

Present, and get approval on:

| Dataset | Verdict | Space function | Id plan | Delete plan | Writers to route | Reads to replace | Risks |
| --- | --- | --- | --- | --- | --- | --- | --- |

plus the order of features (smallest, most self-contained first), the rollout plan, and the open questions. Record the approved assessment in the repo (`docs/ferry-migration.md` or the project's convention) so later sessions resume from it.
