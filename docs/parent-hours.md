# Parent estimate policy

The parent estimate is preserved when adding, editing, completing, reopening, or deleting children. It increases only when the sum of child estimates exceeds the current parent estimate. Completed and archived children retain their estimate in that sum. Child operations do not reduce the parent's focus budget.

Examples: parent 8h plus child 2h stays 8h; child total 10h raises it to 10h; reducing or deleting children does not lower it. Direct parent editing remains available. Previously reduced values are not automatically restored because the original input is unknown.

Client validation: 86 Angular tests passed. Server validation: 16 tests passed. Server deployment on 2026-10-06 was blocked by expired Firebase credentials; deploy deleteTaskSafely after reauthentication.
