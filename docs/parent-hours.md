# Parent remaining hours: targeted bug fixes

The existing allocation policy is preserved. A focused parent continues to include each unfinished child's full estimate in that child's assignee's focused workload. No proportional allocation was introduced; existing count and forecast policies are unchanged.

When a child is completed or its status changes, the parent estimate is refreshed from unfinished, non-archived children. The parent's focus hours are capped at that remainder, including zero. Completion refreshes the parent even if subsequent recurrence creation fails.

Server task deletion now excludes completed and archived surviving siblings when updating the parent. Its transactional parent update also caps focus hours, including zero.

Validation: 54 Angular tests and 16 server tests passed. Existing stored data is not bulk rewritten. Concurrent status changes and multi-level rollups remain outside this targeted fix and need separate validation.
