# Task deletion

Task trees are deleted through the `deleteTaskSafely` callable in `asia-northeast1`.
Direct client deletion of task documents is denied by Firestore rules.

An authenticated, active member must be a manager, creator, or current assignee of
**every task** in the tree. A forbidden descendant aborts the entire transaction.
Deleting a tree also deletes other authors' comments, attachments, and history.
Individual comment/attachment deletion remains author-only.

## Atomic records and retryable file cleanup

The server reads the current tree and related collections in a Firestore
transaction. After all checks, it deletes the records, updates the surviving
parent's estimate, creates `taskDeletionMarkers/{taskId}` for each removed task,
and writes `taskDeletionJobs/{rootTaskId}`. The markers prevent ID/path reuse.
All those writes commit together or fail together. Storage files are untouched
until the transaction commits.

Jobs retain `remainingPaths`, `requestedBy`, `status`, `attempts`, `lastError`,
`leaseUntil`, `nextAttemptAt`, and timestamps. Clients cannot write jobs or
markers. A repeated request by the original requester (or an active manager)
reuses the existing job, including after a lost HTTP response.

File cleanup happens immediately after commit, then `retryTaskFileCleanup`
retries due jobs every five minutes. A five-minute lease prevents overlapping
workers. Missing objects (404/object-not-found) count as removed; permission and
network errors remain pending with exponential backoff, capped at one hour.
Jobs are processed in due-time order so persistent failures do not starve others.

Firestore and Storage are separate systems: a committed task deletion is not
rolled back because Storage cleanup failed. Such responses have
`cleanupPending: true`. Check pending jobs and function logs for prolonged errors.

## Limits and concurrent operations

To preserve atomicity, trees are limited to 100 tasks and 450 combined writes
(including related documents, markers, the job, and parent update). Oversized
trees are rejected before any mutation; delete smaller child trees first.
Multiple roots selected in the board are processed separately. Successful roots
are removed from the selection; unsuccessful roots remain available for retry.
The confirmation explains this behavior and deletion of other authors' posts.

Rules require a surviving parent when creating/moving children or adding posts,
protect `createdBy` on update, and reject recreation of deleted task IDs.
Storage uploads require the task to exist. These checks complement transactional
server reads; they do not replace a broader authorization audit (item 4).

## Verification

- `npm.cmd test --prefix functions`: backend transaction/cleanup tests.
- `npm.cmd test -- --watch=false --include=src/app/core/services/task-deletion-client.spec.ts --include=src/app/core/services/attachment-deletion.spec.ts`: client and individual attachment deletion tests.
- `npm.cmd run build -- --configuration development`: Angular type/template build.
- Firebase rules dry-run and Rules test API permission scenarios.
- Rules regression command (Windows with Firebase CLI installed globally):
  `node scripts/test-task-deletion-rules.cjs C:/Users/pluser1/AppData/Roaming/npm/node_modules/firebase-tools`.
  This uses CLI authentication and the Rules test API; it never deletes live data.

Deployment verification confirmed an active callable, unauthenticated rejection,
the expected attachment bucket, and an enabled five-minute cleanup schedule.

Rules are a reviewed prototype rather than a complete application security audit.
Before general release, test actual multi-user operations, concurrent uploads,
lost responses, and prolonged storage failures in a dedicated staging project.
