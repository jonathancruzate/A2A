# SPEC Amendment — SPREADSHEET Binding (draft for `docs/specification.md`)

Status: draft insertion text for the fork, not yet applied to
`docs/specification.md`. Numbering below (`## 16.`) is provisional:
on acceptance the maintainers should place this section immediately
after the Email Protocol Binding section (§15 in the companion
amendment), renumbering later sections, and add the SPREADSHEET
column to the tables in Sections 5.3 and 5.4. The full design —
including the live reference deployment it formalizes — lives in
`spreadsheet-binding/SPEC.md` in the fork.

Companion changes (separate commits, see `email-binding/COMMITS.md`):

- Section 5.3: add a `Spreadsheet Operation` column to the Method
  Mapping Reference table (values in §16.4 below).
- Section 5.4: add a `Spreadsheet Representation` column (values in
  §16.5 below).
- `specification/a2a.proto`: the same comment-only addition as for
  EMAIL (one shared `feat:` commit; draft patch:
  `email-binding/proto-additions.patch.txt`).

Sheet layout: this amendment specifies sheet layout **v2**
(2026-11-06), in which every column is a canonical A2A field name
or the object's `metadata` serialised in a `metadata_json`
column. Layout v1 (the legacy column names) is decode-only; the
v1 → v2 mapping is Appendix B of `spreadsheet-binding/SPEC.md`.

---

## 16. Spreadsheet Protocol Binding

The Spreadsheet protocol binding provides an asynchronous,
store-and-forward interface using a shared spreadsheet whose tabs
act as append-only queues. It is intended for agents whose
platform provides first-party spreadsheet access in unattended
runs but no agent email address and no hostable endpoint. The
binding preserves the canonical data model (Section 4) and the
abstract operations (Section 3) without change. A reference
deployment between a hosted agent and a Workspace-native agent
has run in production since 2025 (doorbell revision verified
end-to-end in November 2025).

### 16.1. Protocol Requirements

- **Protocol:** A spreadsheet with append, read, and delete-row
  primitives and an access control list (ACL). The reference
  provider is Google Sheets.
- **Endpoint:** The spreadsheet's canonical HTTPS URL, declared in
  the Agent Card (see Section 16.7). The spreadsheet ID parsed
  from that URL is the endpoint identity. Implementations **MUST**
  key all state by (spreadsheet ID, tab name) and **MUST NOT** use
  the spreadsheet's display title as an identifier, because titles
  are renamable.
- **Streaming:** Not supported. Agents **MUST** declare
  `streaming: false` for this binding.
- **Push Notifications:** Supported, realized as a content-free
  wake signal plus polling (see Section 16.3).

### 16.2. Service Parameter Transmission

Spreadsheets have no headers. `A2A-Version` and `A2A-Extensions`
(Section 3.2.6) **MUST** be carried in
the request row's `metadata_json` under the key `a2a`, of the form
`{"version": "1.0", "extensions": ["…"]}`. Absence means version
`1.0` and no extensions. Responses carry the same information in
the returned `Task` object's `metadata` under the key `a2a`
(mirrored in the row's `metadata_json` column).

### 16.3. Wake-Up and Polling

A spreadsheet cannot push. This binding defines one wake signal
and one fallback; neither carries payload data.

#### 16.3.1. Doorbell

A script bound to the spreadsheet, triggered by any change to the
spreadsheet, checks whether the `Requests` tab has data rows and,
if so, sends one email to the single account the responding agent
watches, subject exactly `A2A-Event`, body limited to a statement
that a request is pending. The script **MUST** debounce with a
15-second cache entry so that batch inserts produce one alert, and
**MUST NOT** write to the spreadsheet, process rows, or modify
triggers. The responding agent's processing schedule is triggered
by mail matching that exact subject and, on waking, reads all
pending request rows; the alert is a hint that work exists, not a
work item.

#### 16.3.2. Polling Fallback

If the doorbell is unavailable, a time-based schedule **MAY** poll
the `Requests` tab as a backstop; only latency depends on it. The
requesting direction (responses) is polled: the requester's poller
reads the `Results` and `Notes` tabs on a fixed cadence, which
**SHOULD** be at most 5 minutes.

### 16.4. Core Methods

#### 16.4.1. Sheet Contract (Layout v2)

Row 1 of each tab is a frozen header row with exactly these
columns, in this order. Data rows are appended after it. Every
column is either a canonical A2A field name (as in the protocol
definition) or the object's canonical `metadata` serialised in a
`metadata_json` column; there are no bespoke field names.
Writers **MUST** write layout v2; readers **MUST** also accept
layout v1, whose columns map to v2 as defined in the binding
specification's legacy appendix (decode-only).

**Requests** (requester appends, responder reads) — a row is a
`Message`:

```text
appended_at | message_id | task_id | context_id | kind | parts_json | metadata_json
```

**Results** (responder appends, requester reads) — a row is a
`Task`:

```text
appended_at | task_id | context_id | status | task_json | metadata_json
```

**Notes** (responder appends, requester reads) — a row is a
non-task `Message`:

```text
appended_at | message_id | parts_json | metadata_json
```

**Card** (responder maintains):

```text
appended_at | card_version | card_json
```

The `Card` tab holds exactly one current data row containing the
responder's complete `AgentCard`; it is replaced in place on card
changes — the single exception to append-only behavior in this
binding. Readers **MUST** tolerate a missing `Card` tab (see
Section 16.4.8). The deployment's sheet layout is declared inside
`card_json`, in the SPREADSHEET extension's `params` as
`"sheetLayout": "2"`; absence means layout v1.

Provider cell limits bind (for example, 50,000 characters per cell
in Google Sheets). Payloads **SHOULD** be at most 40,000
characters. Larger payloads travel by reference (a `url` `Part` or
a store key). This version defines no chunking.

#### 16.4.2. `SendMessage`

- **Request:** Append one `Requests` row.
    - `message_id` is the canonical `Message.messageId`, unique
    per spreadsheet. Together with the `a2a.token` metadata key
    it forms the idempotency key.
    - `task_id` is the canonical `Message.taskId`: empty when the
    message starts a new task. A sheet-created task's `Task.id`
    is assigned by the responder and learned from the first
    `Results` row whose `task_json.history` contains the
    `message_id`.
    - `context_id` is the canonical `Message.contextId`, the
    value only; `referenceTaskIds`, when needed, ride in
    `metadata_json`.
    - `metadata_json` is the canonical `Message.metadata`. It
    **MUST** carry `a2a.token`: a sender-generated, per-message
    random value with at least 64 bits of entropy, never reused.
    The token is binding metadata, not a canonical field, so it
    lives in `metadata` — never in a bespoke column.
    - `kind` is a dotted name. Names not starting with `a2a.` invoke
    the skill identified by that name (for example,
    `flights.search`); names starting with `a2a.` are reserved
    protocol operations defined by this section.
    - `parts_json` is the canonical array of `Part` objects,
    serialised unmodified. A `data` `Part` is simply one element
    of the array; `text` and `url` `Part`s are elements too.
- **Response:** One terminal `Results` row (Section 16.4.3),
  optionally preceded by non-terminal rows.

**Structured data only.** The `Part`s of a request row **MUST**
carry data and **MUST NOT** contain prose instructions,
imperatives, or natural-language task descriptions in any `Part`.
Standing instructions for executing a `kind` live in the
responding agent's own configuration (for Gemini Spark, its A2A
skill — its schedule prompt is only a thin trigger that invokes
the skill) and are changed on the responder side only. This
requirement is empirical: the reference platform blocks
instruction-like payloads in unattended runs, so a violating row
is undeliverable.

#### 16.4.3. Task Responses (`Results` Rows)

The `status` column is the verbatim canonical `Task.status.state`
(the `TASK_STATE_*` value) — the only write form. `task_json` is
the canonical `Task` object; `metadata_json` mirrors the `Task`'s
`metadata` and echoes the triggering message's `a2a.token` (inside
`task_json.metadata` as well), and the row is linked to its
message by `task_json.history` — there is no request column on
`Results`. A result whose token echo does not match the token
recorded for the linked `message_id` **MUST NOT** be committed.
Readers **MUST** also decode layout v1 rows: the v1 `status`
spellings map to canonical states (`done` →
`TASK_STATE_COMPLETED`, `error` → `TASK_STATE_FAILED`, `working`
→ `TASK_STATE_WORKING`, `cancelled` → `TASK_STATE_CANCELED`,
`input_required` → `TASK_STATE_INPUT_REQUIRED`, plus
`auth_required`, `submitted`, `rejected` analogously), and a v1
`result_json` that is a plain answer object (rather than a `Task`)
is wrapped on decode as a `Task` with the mapped state and one
`Artifact` whose single `data` `Part` is that object. For errors,
`task_json` is an error object (Section 16.5). A responder **MAY**
append `TASK_STATE_WORKING` rows before the terminal row;
consumers treat them as notifications and never commit-and-clear
on them.

#### 16.4.4. `SendStreamingMessage` and `SubscribeToTask`

Streaming is not supported; an insistent streaming request is
answered with an `error` row carrying
`UnsupportedOperationError`. `SubscribeToTask` is realized by the
progress rows of Section 16.4.3 plus polling (Section 16.3.2).

#### 16.4.5. `GetTask`

A local read; no row is written. The requester searches `Results`
rows by `task_id` (the row's `task_id` column, or the `Task`'s
history link to the request's `message_id`) and checks the row's
`a2a.token` echo against the token it recorded for that message:
a terminal row yields that `Task`; only non-terminal rows yield a
`Task` in `TASK_STATE_WORKING`; no `Results` row with an existing
`Requests` row yields `TASK_STATE_SUBMITTED`; neither yields
`TaskNotFoundError`. A token mismatch is indistinguishable from
absence, so task existence is never leaked to a non-holder of the
token. State held only inside the responder is queried with a
`Requests` row of kind `a2a.get_task`.

#### 16.4.6. `ListTasks`

A local scan; no row is written. The requester joins `Requests`
and `Results` rows on `task_id` and the `Task` history's
`messageId` link (v2), applies the requested filters, and orders
by `appended_at`. Pagination is an offset over the scan, carried
in `pageSize` and `pageToken`.

#### 16.4.7. `CancelTask`

Cancellation is a request, never an edit or a deletion, because
the medium is append-only and deletion is reserved for cleanup
(Section 16.6):

1. The requester appends a `Requests` row with kind `a2a.cancel`
   and a fresh (`message_id`, `a2a.token`) pair. Its `parts_json`
   carries a `data` `Part` of the form
   `{"target_task_id": "…"}` naming the target by its canonical
   `task_id`, and its `metadata_json` carries `a2a.target_token`
   — the `a2a.token` of the original message that created the
   target — proving the canceller owns the target task.
2. If the target has no terminal `Results` row, the responder
   abandons the work, appends the target's terminal row with
   status `TASK_STATE_CANCELED`, and answers the cancel row with
   status `TASK_STATE_COMPLETED`.
3. If the target is already terminal, the responder answers the
   cancel row with status `TASK_STATE_FAILED` and code
   `TaskNotCancelableError` — except that cancelling an
   already-cancelled target returns its cancelled state as
   `TASK_STATE_COMPLETED` (idempotent cancellation, compare
   Section 3.3.1).
4. A cancellation can lose the race against completion. The
   binding defines no "cancel pending" state and implementations
   **MUST NOT** claim one.

#### 16.4.8. `GetExtendedAgentCard` and Agent Card Discovery

`GetAgentCard` is reading the `Card` tab (Section 16.4.1). If the
tab is absent, the requester appends a `Requests` row with kind
`a2a.get_agent_card`; the responder answers with the card as the
answering `Task`'s artifact in `task_json` and creates the `Card`
tab, so the fallback runs at most once.
`GetExtendedAgentCard` is answered with
`ExtendedAgentCardNotConfiguredError` unless the card declares
`extendedAgentCard: true`.

#### 16.4.9. Push Notification Configuration Methods

A `CreateTaskPushNotificationConfig` whose `url` is a `mailto:`
URL naming the doorbell recipient is a no-op success, because the
doorbell already notifies that account. Any other URL is answered
with `PushNotificationNotSupportedError`. Get/List/Delete mirror
that stance.

#### 16.4.10. Non-Task Messages (`Notes` Rows)

A `Notes` row decodes to a `Message` with `role: ROLE_AGENT`, the
`parts_json` array as its `Part`s (a note is normally one text
`Part`), and `metadata` from `metadata_json` — priority rides
there as the metadata key `a2a.priority`. Notes are
communication, not task payloads, and **MUST NOT** be used to
carry a task past Section 16.4.2's structured-data rule.

### 16.5. Error Handling

Failures are terminal `Results` rows with status
`TASK_STATE_FAILED` and a `task_json` error object following
Section 3.3.2. The following column is
proposed for the table in Section 5.4:

| A2A Error Type | Spreadsheet Representation |
| :--- | :--- |
| `TaskNotFoundError` | Local verdict (Section 16.4.5), or a `TASK_STATE_FAILED` row answering `a2a.get_task` or `a2a.cancel` |
| `TaskNotCancelableError` | `TASK_STATE_FAILED` row answering the `a2a.cancel` row |
| `PushNotificationNotSupportedError` | `TASK_STATE_FAILED` row (Section 16.4.9) |
| `UnsupportedOperationError` | `TASK_STATE_FAILED` row (including unknown skill `kind` values, which are never silently ignored) |
| `ContentTypeNotSupportedError` | `TASK_STATE_FAILED` row naming the media type or the oversize payload |
| `InvalidAgentResponseError` | Raised locally on malformed `task_json`; the row is kept and surfaced, never committed |
| `ExtendedAgentCardNotConfiguredError` | `TASK_STATE_FAILED` row (Section 16.4.8) |
| `ExtensionSupportRequiredError` | `TASK_STATE_FAILED` row naming the extension URI |
| `VersionNotSupportedError` | `TASK_STATE_FAILED` row naming the supported version; also a trigger to re-read the `Card` tab |

Transport failures (spreadsheet unreachable, access revoked)
cannot be carried by a row. The affected agent surfaces them to
its principal through its own channels and **MUST NOT** fall back
to delivering the payload by doorbell email or any other channel.

### 16.6. Idempotency, Cleanup, and Ordering

- **Idempotency:** Processing **MUST** be idempotent on
  (`message_id`, `a2a.token`). A duplicate `Requests` row is
  processed and answered once. The same `message_id` with a
  different `a2a.token` is a collision: neither row is trusted
  for the other, and the collision is surfaced.
- **Cleanup:** Each agent's own store is canonical; the sheet is
  transport only. The requester commits a matched terminal
  `Results` row to its store, verifies the commit, and only then
  deletes that row. Unmatched rows are kept and surfaced, never
  silently dropped. The requester prunes `Requests` rows whose
  requests are done in its store; the responder **MUST NOT**
  delete `Requests` rows. `Notes` rows are cleared after verified
  ingestion. The `Card` tab is never pruned.
- **Ordering:** Row order within a tab is append order and is
  authoritative; `appended_at` is a cross-check. A previously read
  non-terminal row **MUST NOT** regress a committed terminal
  state.

### 16.7. Authentication and Agent Card Declaration

There is no on-wire credential. Access control is the
spreadsheet's ACL: the sheet **MUST** be shared with exactly the
two agents' operating accounts (plus the principals as owners)
and **MUST NOT** be link-shared or public. A `Results` row is
committed if and only if its `a2a.token` echo matches the token
recorded for the `message_id` the row's `Task` history links to,
in the consumer's own store; that match
is simultaneously the idempotency check and the authentication of
the result. Apart from the metadata key `a2a.token`, rows
**MUST NOT** contain bearer tokens, API keys, passwords, or
one-time codes.

Agents **MUST** declare this binding in `supportedInterfaces`:

```json
{
  "supportedInterfaces": [
    {
      "url": "https://docs.google.com/spreadsheets/d/<ID>/edit",
      "protocolBinding": "SPREADSHEET",
      "protocolVersion": "1.0"
    }
  ],
  "capabilities": {
    "streaming": false,
    "pushNotifications": true
  }
}
```
